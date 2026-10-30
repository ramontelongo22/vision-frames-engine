/**
 * Vision Frames v1 - Delivery Boundary
 * Single source of truth: spec/VisionFrames_v1.pdf Section 7 and System Flow step 7
 *
 * Success Exit: a frame passes QA -> delivered.
 * Silent Stop Exit: no explanations, no warnings, no "try again" coaching.
 *
 * Whatever is shown to a user must come from toPublicOutcome, never from EngineResult
 * directly: exit reasons, violations, and events are internal diagnostics.
 *
 * How technical or payment failures should look to a user is not settled (handoff D11);
 * until it is, every non-success outcome projects to the same silent "ended" state.
 *
 * v2 boards (V2-02): a board delivers the frames that passed, in board order, plus a
 * board image when two or more passed, and says how many frames were refunded but never
 * why. A board where nothing passed ends exactly like a single frame that stops.
 */

import type { BoardResult } from './board';
import { EngineResult } from './engine';
import { ImageMimeType } from './images';

export interface PublicImage {
  bytes: Uint8Array;
  mimeType: ImageMimeType;
  width: number;
  height: number;
}

export type PublicOutcome = { status: 'delivered'; image: PublicImage } | { status: 'ended' };

export type PublicBoardOutcome =
  | {
      status: 'delivered';
      /** Delivered frames in board order */
      frames: PublicImage[];
      /** Present when two or more frames were delivered */
      boardImage?: PublicImage;
      framesOrdered: number;
      /** Ordered frames left off the board and refunded */
      framesRefunded: number;
    }
  | { status: 'ended' };

export function toPublicOutcome(result: EngineResult): PublicOutcome {
  if (result.success && result.exitReason === 'success' && result.finalImage) {
    const { bytes, mimeType, width, height } = result.finalImage;
    return { status: 'delivered', image: { bytes, mimeType, width, height } };
  }
  return { status: 'ended' };
}

export function toPublicBoardOutcome(result: BoardResult): PublicBoardOutcome {
  const frames = result.frames.flatMap((frame) => {
    const outcome = frame.status === 'delivered' && frame.result ? toPublicOutcome(frame.result) : undefined;
    return outcome?.status === 'delivered' ? [outcome.image] : [];
  });
  if (frames.length === 0 || result.size === undefined) {
    return { status: 'ended' };
  }
  const board = result.boardImage;
  return {
    status: 'delivered',
    frames,
    ...(board && frames.length >= 2
      ? { boardImage: { bytes: board.bytes, mimeType: board.mimeType, width: board.width, height: board.height } }
      : {}),
    framesOrdered: result.size,
    framesRefunded: result.size - frames.length,
  };
}
