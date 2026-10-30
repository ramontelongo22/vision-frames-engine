/**
 * v2 board runner (V2-02): every frame is an independent v1 engine run
 *
 * The fake models route each call to the frame it belongs to by the frame's place,
 * which the canonical prompt carries, so per-frame scripts stay exact even when frames
 * run at the same time.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { decode as decodeJpeg } from 'jpeg-js';
import { PNG } from 'pngjs';
import { BoardEvent, BoardOptions, BoardResult, VisionFramesBoard } from '../src/board';
import { BoardImageOptions, boardGeometry } from '../src/boardImage';
import { toPublicBoardOutcome } from '../src/delivery';
import { MOCK_QUOTA_GENERATION, MockImageGenerationModel, ScriptedAnalysisModel, mockScenarioScript } from '../src/dev/mockModels';
import { ImageAnalysisModel, ImageGenerationModel } from '../src/engine';
import { ProviderError } from '../src/errors';
import { ImagePayload } from '../src/images';
import { SemanticNormalizer } from '../src/semanticNormalizer';
import { fail, pass, png, references, webpVp8x } from './helpers';

afterEach(() => jest.restoreAllMocks());

const SETTINGS = [
  'An open field',
  'A quiet shore',
  'A forest trail',
  'A lakeside path',
  'A mountain ridge',
  'A city street',
  'A garden path',
  'A wide beach',
  'A river bank',
];
const TYPED = [
  'a misty harbour',
  'a stone bridge',
  'a pine forest',
  'a desert road',
  'a snowy valley',
  'a rocky coast',
  'a quiet plaza',
  'a tidal flat',
  'a canyon rim',
];
const SMALL_IMAGE: BoardImageOptions = {
  cellWidth: 64,
  cellAspect: 16 / 9,
  gutter: 4,
  margin: 8,
  background: [245, 243, 238],
  jpegQuality: 95,
};
const IDENTITY = 'calm and grounded';

type Step<T> = T | Error;

interface FakeOptions {
  /** Analyzer results for a frame, by place, in that frame's call order; the last repeats. Default: pass */
  reports?: Record<string, Array<Step<unknown>>>;
  /** Generation results for a frame, by place; the last repeats. Default: a fresh PNG */
  generations?: Record<string, Array<Step<ImagePayload | undefined>>>;
  refinements?: Record<string, Array<Step<ImagePayload | undefined>>>;
  /** Yield to the event loop inside every generation call so frames overlap */
  slow?: boolean;
  /** Called on every analysis, before it returns */
  onAnalyze?: (place: string, call: number) => void;
  /** Return WebP headers instead of PNGs */
  webp?: boolean;
}

interface Fake {
  generator: ImageGenerationModel;
  analyzer: ImageAnalysisModel;
  calls: Array<{ operation: 'generate' | 'refine' | 'analyze'; place: string; references: number }>;
  callsFor: (place: string) => string[];
  maxGenerationsInFlight: () => number;
}

function fakeModels(options: FakeOptions = {}): Fake {
  const known = [...TYPED, ...SETTINGS];
  const placeOf = new WeakMap<Uint8Array, string>();
  const calls: Fake['calls'] = [];
  let images = 0;
  let inFlight = 0;
  let maxInFlight = 0;

  const placeIn = (prompt: string): string => {
    const place = known.find((candidate) => prompt.includes(candidate));
    if (!place) throw new Error('test: no known place in prompt');
    return place;
  };
  const nth = (operation: string, place: string) =>
    calls.filter((c) => c.operation === operation && c.place === place).length;
  const pick = <T>(script: Array<Step<T>> | undefined, n: number): T | undefined => {
    const step = script?.[Math.min(n - 1, script.length - 1)];
    if (step instanceof Error) throw step;
    return step;
  };
  const image = (place: string): ImagePayload => {
    images++;
    const bytes = options.webp ? webpVp8x(160, 90) : png(160, 90, [(images * 37) % 256, (images * 91) % 256, 120]);
    placeOf.set(bytes, place);
    return { bytes, mimeType: options.webp ? 'image/webp' : 'image/png' };
  };

  const generator: ImageGenerationModel = {
    async generate(call) {
      const place = placeIn(call.prompt);
      calls.push({ operation: 'generate', place, references: call.references.length });
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      try {
        if (options.slow) await new Promise((resolve) => setImmediate(resolve));
        return pick(options.generations?.[place], nth('generate', place)) ?? image(place);
      } finally {
        inFlight--;
      }
    },
    async refine(call) {
      const place = placeIn(call.prompt);
      calls.push({ operation: 'refine', place, references: call.references.length });
      return pick(options.refinements?.[place], nth('refine', place)) ?? image(place);
    },
  };
  const analyzer: ImageAnalysisModel = {
    async analyze(call) {
      const place = placeOf.get(call.candidate.bytes);
      if (!place) throw new Error('test: unknown candidate');
      calls.push({ operation: 'analyze', place, references: call.references.length });
      const n = nth('analyze', place);
      options.onAnalyze?.(place, n);
      return pick(options.reports?.[place], n) ?? pass();
    },
  };
  return {
    generator,
    analyzer,
    calls,
    callsFor: (place) => calls.filter((c) => c.place === place).map((c) => c.operation),
    maxGenerationsInFlight: () => maxInFlight,
  };
}

function board(fake: Fake, options: BoardOptions = {}, refs: unknown[] = references(2)): VisionFramesBoard {
  return new VisionFramesBoard(fake.generator, fake.analyzer, refs, {
    settings: SETTINGS,
    random: () => 0, // fills with SETTINGS in order
    image: SMALL_IMAGE,
    ...options,
  });
}

/** Every board ends with exactly one board_terminated event, last, matching the exit reason */
function expectTerminated(result: BoardResult): void {
  const terminations = result.events.filter((e) => e.type === 'board_terminated');
  expect(terminations).toHaveLength(1);
  expect(result.events[result.events.length - 1]).toEqual({ type: 'board_terminated', reason: result.exitReason });
  expect(result.deliveredCount + result.refundedCount).toBe(result.size ?? 0);
  for (const frame of result.frames) {
    if (frame.result) {
      const last = frame.result.events[frame.result.events.length - 1];
      expect(last).toEqual({ type: 'terminated', reason: frame.result.exitReason });
    }
  }
}

function eventsOf<T extends BoardEvent['type']>(result: BoardResult, type: T): Array<Extract<BoardEvent, { type: T }>> {
  return result.events.filter((e): e is Extract<BoardEvent, { type: T }> => e.type === type);
}

function rgbAt(bytes: Uint8Array, mimeType: string, x: number, y: number): number[] {
  const image =
    mimeType === 'image/png'
      ? PNG.sync.read(Buffer.from(bytes))
      : decodeJpeg(Buffer.from(bytes), { useTArray: true });
  const o = (y * image.width + x) * 4;
  return Array.from(image.data.subarray(o, o + 3));
}

describe('a board is one independent v1 run per frame', () => {
  it('runs each frame with the shared photos, identity and mood, and its own place', async () => {
    const fake = fakeModels();
    const result = await board(fake).execute({
      size: 3,
      identityDirection: IDENTITY,
      moodTone: 'steady',
      places: [TYPED[0]],
    });

    expect(result.exitReason).toBe('complete');
    expect(result.size).toBe(3);
    expect(result.deliveredCount).toBe(3);
    expect(result.refundedCount).toBe(0);
    expect(result.frames.map((f) => [f.position, f.placeSource, f.status])).toEqual([
      [1, 'customer', 'delivered'],
      [2, 'settings_list', 'delivered'],
      [3, 'settings_list', 'delivered'],
    ]);
    expect(eventsOf(result, 'places_planned')).toEqual([{ type: 'places_planned', customer: 1, filled: 2 }]);
    for (const place of [TYPED[0], SETTINGS[0], SETTINGS[1]]) {
      expect(fake.callsFor(place)).toEqual(['generate', 'analyze']);
    }
    expect(fake.calls.every((c) => c.references === 2)).toBe(true);
    for (const frame of result.frames) {
      expect(frame.result?.exitReason).toBe('success');
      expect(frame.result?.generationAttempts).toBe(1);
    }
    expect(result.boardImage?.mimeType).toBe('image/jpeg');
    expectTerminated(result);
  });

  it('puts the identity and mood into every frame prompt, and nothing from other frames', async () => {
    const prompts: string[] = [];
    const fake = fakeModels();
    const generate = fake.generator.generate.bind(fake.generator);
    fake.generator.generate = (call) => {
      prompts.push(call.prompt);
      return generate(call);
    };
    await board(fake).execute({ size: 3, identityDirection: IDENTITY, moodTone: 'steady', places: TYPED.slice(0, 3) });

    expect(prompts).toHaveLength(3);
    prompts.forEach((prompt, i) => {
      expect(prompt).toContain(IDENTITY);
      expect(prompt).toContain('steady');
      expect(prompt).toContain(TYPED[i]);
      TYPED.slice(0, 3)
        .filter((_, j) => j !== i)
        .forEach((other) => expect(prompt).not.toContain(other));
    });
  });

  it('gives every frame its own 3 generations and never adds attempts', async () => {
    const reports = [fail('isSeated'), fail('hasObjects'), fail('hasMultiplePeople')];
    const fake = fakeModels({ reports: Object.fromEntries(TYPED.slice(0, 3).map((p) => [p, reports])) });
    const result = await board(fake).execute({ size: 3, identityDirection: IDENTITY, places: TYPED.slice(0, 3) });

    expect(result.exitReason).toBe('nothing_delivered');
    for (const frame of result.frames) {
      expect(frame.result?.exitReason).toBe('generations_exhausted');
      expect(frame.result?.generationAttempts).toBe(3);
    }
    expect(fake.calls.filter((c) => c.operation === 'generate')).toHaveLength(9);
    expect(fake.calls.filter((c) => c.operation === 'analyze')).toHaveLength(9);
    expectTerminated(result);
  });

  it('gives every frame its own 2 refinements and keeps each passed frame (V2-01)', async () => {
    const reports = [pass('lighting'), fail('isSeated'), fail('hasObjects')];
    const fake = fakeModels({ reports: Object.fromEntries(TYPED.slice(0, 3).map((p) => [p, reports])) });
    const result = await board(fake).execute({ size: 3, identityDirection: IDENTITY, places: TYPED.slice(0, 3) });

    expect(result.exitReason).toBe('complete');
    for (const frame of result.frames) {
      expect(frame.result?.refinementAttempts).toBe(2);
      expect(frame.result?.finalImage?.origin).toBe('generation');
      expect(frame.result?.events).toContainEqual({ type: 'refinement_abandoned', baseId: 'generation-1', cause: 'attempts_failed' });
    }
    expectTerminated(result);
  });

  it('counts hard stops within a frame only', async () => {
    const likeness = fail('likenessIssue');
    const fake = fakeModels({
      reports: {
        [TYPED[0]]: [likeness, pass()],
        [TYPED[1]]: [likeness, likeness],
        [TYPED[2]]: [likeness, pass()],
      },
    });
    const result = await board(fake, { concurrency: 1 }).execute({
      size: 3,
      identityDirection: IDENTITY,
      places: TYPED.slice(0, 3),
    });

    // Four likeness failures on the board, but only frame 2 failed likeness twice
    expect(result.frames.map((f) => [f.status, f.result?.exitReason])).toEqual([
      ['delivered', 'success'],
      ['missing', 'likeness_failed_twice'],
      ['delivered', 'success'],
    ]);
    expect(result.exitReason).toBe('partial');
    expect(result.halted).toBeUndefined();
    expectTerminated(result);
  });
});

describe('missing frames and the board image', () => {
  it('leaves a failed frame off, refunds it, and composes the rest in board order', async () => {
    const fake = fakeModels({ reports: { [TYPED[1]]: [fail('likenessIssue'), fail('likenessIssue')] } });
    const result = await board(fake).execute({ size: 3, identityDirection: IDENTITY, places: TYPED.slice(0, 3) });

    expect(result.exitReason).toBe('partial');
    expect(result.deliveredCount).toBe(2);
    expect(result.refundedCount).toBe(1);
    expect(eventsOf(result, 'board_image_composed')).toEqual([
      { type: 'board_image_composed', frames: 2, width: 2 * 8 + 2 * 64 + 4, height: 2 * 8 + 36 },
    ]);

    // Cell 1 shows frame 1 and cell 2 shows frame 3
    const cells = boardGeometry(2, SMALL_IMAGE)?.cells ?? [];
    const boardImage = result.boardImage;
    if (!boardImage) throw new Error('no board image');
    [result.frames[0], result.frames[2]].forEach((frame, i) => {
      const image = frame.result?.finalImage;
      if (!image) throw new Error('no frame image');
      const expected = rgbAt(image.bytes, image.mimeType, 80, 45);
      const actual = rgbAt(boardImage.bytes, 'image/jpeg', cells[i].x + 32, cells[i].y + 18);
      actual.forEach((v, c) => expect(Math.abs(v - expected[c])).toBeLessThanOrEqual(10));
    });

    const outcome = toPublicBoardOutcome(result);
    if (outcome.status !== 'delivered') throw new Error('not delivered');
    expect(Object.keys(outcome).sort()).toEqual(['boardImage', 'frames', 'framesOrdered', 'framesRefunded', 'status']);
    expect(outcome.frames.map((f) => f.bytes)).toEqual([
      result.frames[0].result?.finalImage?.bytes,
      result.frames[2].result?.finalImage?.bytes,
    ]);
    expect(outcome.framesOrdered).toBe(3);
    expect(outcome.framesRefunded).toBe(1);
    expect(outcome.boardImage?.mimeType).toBe('image/jpeg');
    expectTerminated(result);
  });

  it('still delivers the frames when the board image cannot be made', async () => {
    // WebP frames pass the image contract but are not decoded for the board image (P-14)
    const fake = fakeModels({ webp: true });
    const result = await board(fake).execute({ size: 3, identityDirection: IDENTITY, places: TYPED.slice(0, 3) });

    expect(result.exitReason).toBe('complete');
    expect(eventsOf(result, 'board_image_failed')).toEqual([{ type: 'board_image_failed', error: 'unsupported_format' }]);
    expect(result.boardImage).toBeUndefined();
    const outcome = toPublicBoardOutcome(result);
    expect(outcome).toMatchObject({ status: 'delivered', framesOrdered: 3, framesRefunded: 0 });
    expect(outcome).not.toHaveProperty('boardImage');
    expectTerminated(result);
  });

  it('delivers a single passing frame alone, with no board image', async () => {
    const stop = [fail('likenessIssue'), fail('likenessIssue')];
    const fake = fakeModels({ reports: { [TYPED[0]]: stop, [TYPED[2]]: stop } });
    const result = await board(fake).execute({ size: 3, identityDirection: IDENTITY, places: TYPED.slice(0, 3) });

    expect(result.exitReason).toBe('partial');
    expect(result.boardImage).toBeUndefined();
    expect(eventsOf(result, 'board_image_skipped')).toEqual([{ type: 'board_image_skipped', reason: 'single_frame' }]);
    const outcome = toPublicBoardOutcome(result);
    expect(outcome).toMatchObject({ status: 'delivered', framesOrdered: 3, framesRefunded: 2 });
    expect(outcome.status === 'delivered' && outcome.frames).toHaveLength(1);
    expect(outcome).not.toHaveProperty('boardImage');
    expectTerminated(result);
  });

  it('ends quietly with everything refunded when no frame passes', async () => {
    const stop = [fail('likenessIssue'), fail('likenessIssue')];
    const fake = fakeModels({ reports: Object.fromEntries(TYPED.slice(0, 3).map((p) => [p, stop])) });
    const result = await board(fake).execute({ size: 3, identityDirection: IDENTITY, places: TYPED.slice(0, 3) });

    expect(result.exitReason).toBe('nothing_delivered');
    expect(result.refundedCount).toBe(3);
    expect(result.boardImage).toBeUndefined();
    expect(result.events.some((e) => e.type.startsWith('board_image'))).toBe(false);
    expect(toPublicBoardOutcome(result)).toEqual({ status: 'ended' });
    expectTerminated(result);
  });
});

describe('early end', () => {
  it('stops starting new frames after a fatal provider failure and refunds them', async () => {
    const fake = fakeModels({ generations: { [TYPED[2]]: [new ProviderError('quota', 'quota used up')] } });
    const result = await board(fake, { concurrency: 1 }).execute({
      size: 7,
      identityDirection: IDENTITY,
      places: TYPED.slice(0, 7),
    });

    expect(result.frames.map((f) => f.status)).toEqual([
      'delivered',
      'delivered',
      'missing',
      'not_started',
      'not_started',
      'not_started',
      'not_started',
    ]);
    expect(result.frames[2].result?.exitReason).toBe('technical_failure');
    expect(result.halted).toBe('provider_failure');
    expect(eventsOf(result, 'board_halted')).toEqual([{ type: 'board_halted', cause: 'provider_failure', position: 3 }]);
    expect(eventsOf(result, 'frames_not_started')).toEqual([{ type: 'frames_not_started', count: 4 }]);
    expect(result.exitReason).toBe('partial');
    expect(result.refundedCount).toBe(5);
    for (const place of TYPED.slice(3, 7)) {
      expect(fake.callsFor(place)).toEqual([]);
    }
    expectTerminated(result);
  });

  it('lets frames already running finish after a fatal failure', async () => {
    const fake = fakeModels({ slow: true, generations: { [TYPED[0]]: [new ProviderError('auth', 'bad key')] } });
    const result = await board(fake, { concurrency: 3 }).execute({
      size: 7,
      identityDirection: IDENTITY,
      places: TYPED.slice(0, 7),
    });

    expect(eventsOf(result, 'frame_started').map((e) => e.position)).toEqual([1, 2, 3]);
    expect(result.frames.map((f) => f.status)).toEqual([
      'missing',
      'delivered',
      'delivered',
      'not_started',
      'not_started',
      'not_started',
      'not_started',
    ]);
    expect(result.halted).toBe('provider_failure');
    expectTerminated(result);
  });

  it('keeps a frame delivered under V2-01 but still stops the board when the provider fails fatally', async () => {
    const fake = fakeModels({
      reports: { [TYPED[0]]: [pass('lighting')] },
      refinements: { [TYPED[0]]: [new ProviderError('quota', 'quota used up')] },
    });
    const result = await board(fake, { concurrency: 1 }).execute({
      size: 3,
      identityDirection: IDENTITY,
      places: TYPED.slice(0, 3),
    });

    expect(result.frames.map((f) => f.status)).toEqual(['delivered', 'not_started', 'not_started']);
    expect(result.frames[0].result?.events).toContainEqual({ type: 'refinement_abandoned', baseId: 'generation-1', cause: 'quota' });
    expect(result.halted).toBe('provider_failure');
    expect(eventsOf(result, 'board_image_skipped')).toHaveLength(1);
    expectTerminated(result);
  });

  it('does not stop the board for a failure that is not fatal', async () => {
    const fake = fakeModels({ generations: { [TYPED[0]]: [new ProviderError('rate_limit', 'slow down'), undefined] } });
    const result = await board(fake).execute({ size: 3, identityDirection: IDENTITY, places: TYPED.slice(0, 3) });

    expect(result.exitReason).toBe('complete');
    expect(result.halted).toBeUndefined();
    expect(result.frames[0].result?.generationAttempts).toBe(2);
    expectTerminated(result);
  });

  it('starts nothing when cancelled before the first frame', async () => {
    const controller = new AbortController();
    controller.abort();
    const fake = fakeModels();
    const result = await board(fake).execute({ size: 3, identityDirection: IDENTITY }, { signal: controller.signal });

    expect(result.frames.map((f) => f.status)).toEqual(['not_started', 'not_started', 'not_started']);
    expect(result.halted).toBe('cancelled');
    expect(result.exitReason).toBe('nothing_delivered');
    expect(result.refundedCount).toBe(3);
    expect(fake.calls).toEqual([]);
    expect(toPublicBoardOutcome(result)).toEqual({ status: 'ended' });
    expectTerminated(result);
  });

  it('keeps frames already delivered when cancelled part way, and refunds the rest', async () => {
    const controller = new AbortController();
    const fake = fakeModels({ onAnalyze: (place) => place === TYPED[1] && controller.abort() });
    const result = await board(fake, { concurrency: 1 }).execute(
      { size: 3, identityDirection: IDENTITY, places: TYPED.slice(0, 3) },
      { signal: controller.signal }
    );

    expect(result.frames.map((f) => [f.status, f.result?.exitReason])).toEqual([
      ['delivered', 'success'],
      ['missing', 'cancelled'],
      ['not_started', undefined],
    ]);
    expect(eventsOf(result, 'board_halted')).toEqual([{ type: 'board_halted', cause: 'cancelled', position: 2 }]);
    expect(result.exitReason).toBe('partial');
    expect(toPublicBoardOutcome(result)).toMatchObject({ status: 'delivered', framesRefunded: 2 });
    expectTerminated(result);
  });
});

describe('frames running at once', () => {
  const maxConcurrentFrames = (result: BoardResult): number => {
    let running = 0;
    let max = 0;
    for (const event of result.events) {
      if (event.type === 'frame_started') max = Math.max(max, ++running);
      if (event.type === 'frame_finished') running--;
    }
    return max;
  };

  it.each([
    [1, 1],
    [3, 3],
    [undefined, 3],
  ])('with concurrency %p runs at most %i frames at once', async (concurrency, expected) => {
    const fake = fakeModels({ slow: true });
    const result = await board(fake, concurrency === undefined ? {} : { concurrency }).execute({
      size: 9,
      identityDirection: IDENTITY,
    });

    expect(result.exitReason).toBe('complete');
    expect(maxConcurrentFrames(result)).toBe(expected);
    expect(fake.maxGenerationsInFlight()).toBe(expected);
    expectTerminated(result);
  });
});

describe('board intake', () => {
  it.each([
    ['not an object', 'a board', 'input is not an object'],
    ['an unsupported size', { size: 5, identityDirection: IDENTITY }, 'size must be one of 3, 7, 9'],
    ['a missing size', { identityDirection: IDENTITY }, 'size must be one of 3, 7, 9'],
    ['a missing identity', { size: 3 }, 'identityDirection is required and must be a string'],
    ['a mood that is not text', { size: 3, identityDirection: IDENTITY, moodTone: 7 }, 'moodTone must be a string when provided'],
    ['more places than frames', { size: 3, identityDirection: IDENTITY, places: TYPED.slice(0, 4) }, 'more places than frames'],
  ])('rejects %s before any model call', async (_, input, reason) => {
    const fake = fakeModels();
    const result = await board(fake).execute(input);

    expect(result.exitReason).toBe('invalid_input');
    expect(result.events[0]).toEqual({ type: 'board_rejected', reason });
    expect(result.frames).toEqual([]);
    expect(fake.calls).toEqual([]);
    expect(toPublicBoardOutcome(result)).toEqual({ status: 'ended' });
    expectTerminated(result);
  });

  it('drops fields outside the board contract silently', async () => {
    const prompts: string[] = [];
    const fake = fakeModels();
    const generate = fake.generator.generate.bind(fake.generator);
    fake.generator.generate = (call) => {
      prompts.push(call.prompt);
      return generate(call);
    };
    const result = await board(fake).execute({
      size: 3,
      identityDirection: IDENTITY,
      environmentPreference: 'a volcano',
      wardrobe: 'a red coat',
    });

    expect(result.exitReason).toBe('complete');
    expect(eventsOf(result, 'fields_dropped')).toEqual([{ type: 'fields_dropped', count: 2 }]);
    expect(prompts.some((p) => p.includes('volcano') || p.includes('red coat'))).toBe(false);
  });

  it('fills a typed place that filters down to nothing from the settings list', async () => {
    const fake = fakeModels();
    const result = await board(fake).execute({
      size: 3,
      identityDirection: IDENTITY,
      places: ['sitting at a desk holding coffee', TYPED[0]],
    });

    expect(result.frames.map((f) => f.placeSource)).toEqual(['customer', 'settings_list', 'settings_list']);
    expect(fake.callsFor(TYPED[0])).toEqual(['generate', 'analyze']);
    expect(eventsOf(result, 'places_planned')).toEqual([{ type: 'places_planned', customer: 1, filled: 2 }]);
  });

  it('ends before any frame when the identity filters down to nothing', async () => {
    const fake = fakeModels();
    const result = await board(fake).execute({ size: 3, identityDirection: 'sitting at a desk' });

    expect(result.exitReason).toBe('empty_intent');
    expect(result.frames).toEqual([]);
    expect(result.refundedCount).toBe(3);
    expect(fake.calls).toEqual([]);
    expectTerminated(result);
  });

  it('leaves the identity to each frame run when a semantic normalizer is configured', async () => {
    const normalize = jest.fn(async (input: { environmentPreference?: string }) => ({
      identityDirection: 'calm',
      environmentPreference: input.environmentPreference ?? '',
      moodTone: '',
    }));
    const semanticNormalizer: SemanticNormalizer = { normalize };
    const fake = fakeModels();
    const result = await board(fake, { engineOptions: { semanticNormalizer } }).execute({
      size: 3,
      identityDirection: 'sitting at a desk',
    });

    expect(result.exitReason).toBe('complete');
    // One normalization call per frame (P-15)
    expect(normalize).toHaveBeenCalledTimes(3);
  });

  it('keeps customer text out of every board and frame event', async () => {
    const fake = fakeModels();
    const result = await board(fake).execute({
      size: 3,
      identityDirection: 'my secret identity',
      moodTone: 'secret mood',
      places: [`${TYPED[0]} secret`],
    });

    expect(result.exitReason).toBe('complete');
    expect(JSON.stringify(result.events)).not.toContain('secret');
    expect(JSON.stringify(result.frames.map((f) => f.result?.events))).not.toContain('secret');
  });
});

describe('references', () => {
  it('converts HEIC once for the whole board and sends every frame the JPEG', async () => {
    const heic = readFileSync(join(__dirname, 'fixtures', 'reference-160x120.heic'));
    const fake = fakeModels();
    const seen: string[] = [];
    const generate = fake.generator.generate.bind(fake.generator);
    fake.generator.generate = (call) => {
      seen.push(call.references[0].mimeType);
      return generate(call);
    };
    const result = await board(fake, {}, [{ bytes: heic }]).execute({ size: 3, identityDirection: IDENTITY });

    expect(eventsOf(result, 'references_converted')).toEqual([{ type: 'references_converted', count: 1 }]);
    for (const frame of result.frames) {
      expect(frame.result?.events.some((e) => e.type === 'references_converted')).toBe(false);
    }
    expect(seen).toEqual(['image/jpeg', 'image/jpeg', 'image/jpeg']);
  });

  it('ends before any frame when a HEIC reference cannot be decoded', async () => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined); // libheif logs parse errors
    const heic = readFileSync(join(__dirname, 'fixtures', 'reference-160x120.heic'));
    const damaged = Buffer.concat([heic.subarray(0, 64), Buffer.alloc(64)]);
    const fake = fakeModels();
    const result = await board(fake, {}, [{ bytes: damaged }]).execute({ size: 3, identityDirection: IDENTITY });

    expect(result.exitReason).toBe('invalid_references');
    expect(eventsOf(result, 'references_rejected')).toEqual([
      { type: 'references_rejected', reason: 'reference 1 failed validation: heic_decode_failed' },
    ]);
    expect(fake.calls).toEqual([]);
    expectTerminated(result);
  });

  it('ends before any frame when the references are invalid', async () => {
    const fake = fakeModels();
    const result = await board(fake, {}, []).execute({ size: 7, identityDirection: IDENTITY });

    expect(result.exitReason).toBe('invalid_references');
    expect(eventsOf(result, 'references_rejected')).toEqual([
      { type: 'references_rejected', reason: 'reference images are required' },
    ]);
    expect(result.refundedCount).toBe(7);
    expect(fake.calls).toEqual([]);
    expectTerminated(result);
  });
});

describe('board configuration and failures', () => {
  it('refuses an unusable concurrency or settings list', () => {
    const fake = fakeModels();
    expect(() => board(fake, { concurrency: 0 })).toThrow('concurrency');
    expect(() => board(fake, { concurrency: 1.5 })).toThrow('concurrency');
    expect(() => board(fake, { settings: SETTINGS.slice(0, 3) })).toThrow('at least 9');
  });

  it('never throws: an internal error ends the board as a technical failure', async () => {
    const fake = fakeModels();
    const result = await board(fake, {
      random: () => {
        throw new Error('random source failed');
      },
    }).execute({ size: 3, identityDirection: IDENTITY });

    expect(result.exitReason).toBe('technical_failure');
    expect(eventsOf(result, 'internal_error')).toEqual([{ type: 'internal_error', message: 'random source failed' }]);
    expect(toPublicBoardOutcome(result)).toEqual({ status: 'ended' });
    expectTerminated(result);
  });
});

describe('runner mock scenarios', () => {
  it('partial: frame 2 fails likeness twice and is refunded, the rest pass', async () => {
    const result = await new VisionFramesBoard(
      new MockImageGenerationModel(),
      new ScriptedAnalysisModel(mockScenarioScript('partial')),
      references(1),
      { concurrency: 1, image: SMALL_IMAGE }
    ).execute({ size: 7, identityDirection: IDENTITY });

    expect(result.frames.map((f) => f.status)).toEqual([
      'delivered',
      'missing',
      'delivered',
      'delivered',
      'delivered',
      'delivered',
      'delivered',
    ]);
    expect(result.boardImage).toBeDefined();
  });

  it('quota: the provider runs out on the third generation and the board stops', async () => {
    const result = await new VisionFramesBoard(
      new MockImageGenerationModel(MOCK_QUOTA_GENERATION),
      new ScriptedAnalysisModel(mockScenarioScript('quota')),
      references(1),
      { concurrency: 1, image: SMALL_IMAGE }
    ).execute({ size: 7, identityDirection: IDENTITY });

    expect(result.deliveredCount).toBe(2);
    expect(result.halted).toBe('provider_failure');
    expect(result.refundedCount).toBe(5);
  });
});
