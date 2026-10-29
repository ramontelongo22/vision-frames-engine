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
 */

import { EngineResult } from './engine';
import { ImageMimeType } from './images';

export type PublicOutcome =
  | {
      status: 'delivered';
      image: { bytes: Uint8Array; mimeType: ImageMimeType; width: number; height: number };
    }
  | { status: 'ended' };

export function toPublicOutcome(result: EngineResult): PublicOutcome {
  if (result.success && result.exitReason === 'success' && result.finalImage) {
    const { bytes, mimeType, width, height } = result.finalImage;
    return { status: 'delivered', image: { bytes, mimeType, width, height } };
  }
  return { status: 'ended' };
}
