/**
 * Vision Frames v2 - Board runner
 * Source: docs/DECISIONS.md V2-02 (owner-approved board spec, 2026-10-30)
 *
 * A board is 3, 7 or 9 frames ordered together. Each frame is one full, independent
 * run of the v1 engine: its own 3 generations and 2 refinements, the shared reference
 * photos, identity direction and mood, and that frame's place as its environment
 * preference. The board never adds attempts to a frame, hard stops count within a
 * frame only, and V2-01 applies to each frame.
 *
 * A frame that ends with no image is left off the board and refunded at an equal share
 * of the board price; no other frame gets extra attempts to make up for it. The board
 * stops starting new frames only when a frame hits a fatal provider failure or the run
 * is cancelled, and frames never started are refunded too. A board image is composed
 * when at least 2 frames are delivered; a single delivered frame comes alone.
 *
 * Events and records hold no customer text and no image bytes beyond the frames'
 * own results.
 */

import { BOARD } from './config';
import { BoardImageError, BoardImageOptions, composeBoard } from './boardImage';
import { BoardSize, PlannedPlace, assertUsableSettings, BOARD_SETTINGS_DRAFT, isBoardSize, planPlaces, validatePlaces } from './boardPlaces';
import { toPublicOutcome } from './delivery';
import {
  EngineOptions,
  EngineResult,
  ExecuteOptions,
  ExitReason,
  ImageAnalysisModel,
  ImageGenerationModel,
  VisionFramesEngine,
} from './engine';
import { FATAL_FAILURE_KINDS } from './errors';
import { convertHeicReferences, prepareReferences, validateRawInput } from './intake';
import { normalize } from './normalize';
import { RawInput } from './schema';

const BOARD_FIELDS = ['size', 'identityDirection', 'moodTone', 'places'];

export interface BoardOptions {
  /** Frames running at once; defaults to BOARD.concurrency */
  concurrency?: number;
  /** Fill-in settings; defaults to the draft list until the owner marks it */
  settings?: readonly string[];
  /** Source of randomness for choosing fill-in settings */
  random?: () => number;
  /** Passed to every frame's engine run */
  engineOptions?: EngineOptions;
  image?: BoardImageOptions;
}

export type BoardExitReason =
  | 'complete'
  | 'partial'
  | 'nothing_delivered'
  | 'invalid_input'
  | 'invalid_references'
  | 'empty_intent'
  | 'technical_failure';

/** Why a board stopped starting new frames */
export type BoardHalt = 'provider_failure' | 'cancelled';

export type BoardFrameStatus = 'delivered' | 'missing' | 'not_started';

export interface BoardFrame {
  /** 1-based position on the board */
  position: number;
  placeSource: PlannedPlace['source'];
  status: BoardFrameStatus;
  /** The frame's own engine result; absent when the frame never started */
  result?: EngineResult;
}

/**
 * Ordered internal ledger of one board. Contains no customer text and no image bytes.
 */
export type BoardEvent =
  | { type: 'board_rejected'; reason: string }
  | { type: 'fields_dropped'; count: number }
  | { type: 'references_converted'; count: number }
  | { type: 'references_rejected'; reason: string }
  | { type: 'places_planned'; customer: number; filled: number }
  | { type: 'frame_started'; position: number }
  | { type: 'frame_finished'; position: number; exitReason: ExitReason; delivered: boolean }
  | { type: 'board_halted'; cause: BoardHalt; position?: number }
  | { type: 'frames_not_started'; count: number }
  | { type: 'board_image_composed'; frames: number; width: number; height: number }
  | { type: 'board_image_skipped'; reason: 'single_frame' }
  | { type: 'board_image_failed'; error: BoardImageError }
  | { type: 'internal_error'; message: string }
  | { type: 'board_terminated'; reason: BoardExitReason };

export interface BoardResult {
  exitReason: BoardExitReason;
  /** Set when the board stopped starting new frames early */
  halted?: BoardHalt;
  /** The ordered size; absent when the size itself was invalid */
  size?: BoardSize;
  /** One entry per planned frame, in board order */
  frames: BoardFrame[];
  deliveredCount: number;
  /** Ordered frames not delivered; each is refunded at 1/size of the board price */
  refundedCount: number;
  boardImage?: { bytes: Uint8Array; mimeType: 'image/jpeg'; width: number; height: number };
  events: BoardEvent[];
}

type BoardIntake =
  | { ok: true; size: BoardSize; frameInput: RawInput; places: string[]; droppedFieldCount: number }
  | { ok: false; reason: string };

function validateBoardInput(raw: unknown): BoardIntake {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, reason: 'input is not an object' };
  }
  const record = raw as Record<string, unknown>;
  if (!isBoardSize(record.size)) {
    return { ok: false, reason: `size must be one of ${BOARD.sizes.join(', ')}` };
  }
  // Identity direction and mood are checked exactly as a single frame checks them
  const intent = validateRawInput({ identityDirection: record.identityDirection, moodTone: record.moodTone });
  if (!intent.ok) {
    return intent;
  }
  const places = validatePlaces(record.places, record.size);
  if (!places.ok) {
    return places;
  }
  const droppedFieldCount = Object.keys(record).filter((key) => !BOARD_FIELDS.includes(key)).length;
  return { ok: true, size: record.size, frameInput: intent.input, places: places.places, droppedFieldCount };
}

/** A frame whose run met a fatal provider failure, even if V2-01 still delivered it */
function hitFatalFailure(result: EngineResult): boolean {
  return (
    result.exitReason === 'technical_failure' ||
    result.events.some(
      (event) =>
        event.type === 'refinement_abandoned' &&
        event.cause !== 'cancelled' &&
        (FATAL_FAILURE_KINDS as ReadonlySet<string>).has(event.cause)
    )
  );
}

export class VisionFramesBoard {
  private readonly concurrency: number;
  private readonly settings: readonly string[];
  private readonly random: () => number;

  constructor(
    private readonly generationModel: ImageGenerationModel,
    private readonly analysisModel: ImageAnalysisModel,
    private readonly referenceImages: readonly unknown[],
    private readonly options: BoardOptions = {}
  ) {
    this.concurrency = options.concurrency ?? BOARD.concurrency;
    if (!Number.isInteger(this.concurrency) || this.concurrency < 1) {
      throw new Error('board concurrency must be a positive integer');
    }
    this.settings = options.settings ?? BOARD_SETTINGS_DRAFT;
    assertUsableSettings(this.settings);
    this.random = options.random ?? Math.random;
  }

  /**
   * Make every frame of one board. Never throws: every outcome is a BoardResult.
   */
  async execute(rawInput: unknown, options: ExecuteOptions = {}): Promise<BoardResult> {
    const events: BoardEvent[] = [];
    const board: Omit<BoardResult, 'exitReason' | 'deliveredCount' | 'refundedCount' | 'events'> = { frames: [] };
    let exitReason: BoardExitReason;
    try {
      exitReason = await this.run(rawInput, board, events, options.signal);
    } catch (error) {
      events.push({ type: 'internal_error', message: error instanceof Error ? error.message : String(error) });
      delete board.boardImage;
      exitReason = 'technical_failure';
    }
    events.push({ type: 'board_terminated', reason: exitReason });
    const deliveredCount = board.frames.filter((frame) => frame.status === 'delivered').length;
    return {
      ...board,
      exitReason,
      deliveredCount,
      refundedCount: (board.size ?? 0) - deliveredCount,
      events,
    };
  }

  private async run(
    rawInput: unknown,
    board: Pick<BoardResult, 'frames' | 'size' | 'halted' | 'boardImage'>,
    events: BoardEvent[],
    signal?: AbortSignal
  ): Promise<BoardExitReason> {
    const intake = validateBoardInput(rawInput);
    if (!intake.ok) {
      events.push({ type: 'board_rejected', reason: intake.reason });
      return 'invalid_input';
    }
    board.size = intake.size;
    if (intake.droppedFieldCount > 0) {
      events.push({ type: 'fields_dropped', count: intake.droppedFieldCount });
    }

    // References are converted and checked once for the whole board
    const conversion = await convertHeicReferences(this.referenceImages);
    if (!conversion.ok) {
      events.push({ type: 'references_rejected', reason: conversion.reason });
      return 'invalid_references';
    }
    if (conversion.convertedCount > 0) {
      events.push({ type: 'references_converted', count: conversion.convertedCount });
    }
    const referenceIntake = prepareReferences(conversion.references);
    if (!referenceIntake.ok) {
      events.push({ type: 'references_rejected', reason: referenceIntake.reason });
      return 'invalid_references';
    }
    const references = conversion.references as unknown[];

    // Without a semantic normalizer every frame would stop on the same empty identity,
    // so end here instead. With one, each frame's normalization decides (P-08).
    if (!this.options.engineOptions?.semanticNormalizer && !normalize(intake.frameInput).identityDirection) {
      return 'empty_intent';
    }

    const plan = planPlaces(intake.places, intake.size, this.settings, this.random);
    const customer = plan.filter((place) => place.source === 'customer').length;
    events.push({ type: 'places_planned', customer, filled: plan.length - customer });
    board.frames = plan.map((place, i) => ({ position: i + 1, placeSource: place.source, status: 'not_started' }));

    const halt = (cause: BoardHalt, position?: number) => {
      if (!board.halted) {
        board.halted = cause;
        events.push({ type: 'board_halted', cause, ...(position ? { position } : {}) });
      }
    };

    let next = 0;
    const worker = async () => {
      while (next < plan.length && !board.halted) {
        if (signal?.aborted) {
          halt('cancelled');
          return;
        }
        const index = next++;
        const position = index + 1;
        events.push({ type: 'frame_started', position });
        const engine = new VisionFramesEngine(
          this.generationModel,
          this.analysisModel,
          references,
          this.options.engineOptions
        );
        const result = await engine.execute({ ...intake.frameInput, environmentPreference: plan[index].place }, { signal });
        const delivered = toPublicOutcome(result).status === 'delivered';
        board.frames[index] = { ...board.frames[index], status: delivered ? 'delivered' : 'missing', result };
        events.push({ type: 'frame_finished', position, exitReason: result.exitReason, delivered });
        if (result.exitReason === 'cancelled' || signal?.aborted) {
          halt('cancelled', position);
        } else if (hitFatalFailure(result)) {
          halt('provider_failure', position);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(this.concurrency, plan.length) }, worker));

    const notStarted = board.frames.filter((frame) => frame.status === 'not_started').length;
    if (notStarted > 0) {
      events.push({ type: 'frames_not_started', count: notStarted });
    }

    const delivered = board.frames.flatMap((frame) =>
      frame.status === 'delivered' && frame.result?.finalImage ? [frame.result.finalImage] : []
    );
    if (delivered.length >= 2) {
      const composed = composeBoard(delivered, this.options.image);
      if (composed.ok) {
        board.boardImage = composed.image;
        events.push({
          type: 'board_image_composed',
          frames: delivered.length,
          width: composed.image.width,
          height: composed.image.height,
        });
      } else {
        events.push({ type: 'board_image_failed', error: composed.error });
      }
    } else if (delivered.length === 1) {
      events.push({ type: 'board_image_skipped', reason: 'single_frame' });
    }

    if (delivered.length === plan.length) {
      return 'complete';
    }
    return delivered.length > 0 ? 'partial' : 'nothing_delivered';
  }
}
