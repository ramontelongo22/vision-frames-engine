/**
 * Vision Frames v1 - Configuration
 * Single source of truth: spec/VisionFrames_v1.pdf Section 7
 *
 * Hard-coded limits per specification
 */

export const CONFIG = {
  /**
   * Maximum generation attempts (PDF Section 7).
   * Three total provider calls per frame execution, not one plus three retries.
   */
  maxGenerations: 3,

  /**
   * Maximum refinement attempts (PDF Section 7).
   * One budget for the whole frame execution; never reset by a fallback generation.
   */
  maxRefinements: 2,
} as const;

/**
 * Intake and payload limits.
 *
 * PROVISIONAL: R1 requires reference images but sets no count, size, or format limits
 * (handoff D13). These are internal engineering constraints, not product rules, and
 * must be revisited when the upload policy is decided. See docs/DECISIONS.md (P-09).
 */
export const LIMITS = {
  minReferenceImages: 1,
  maxReferenceImages: 4,
  reference: {
    maxBytes: 4 * 1024 * 1024,
    minDimension: 64,
    maxDimension: 8192,
  },
  candidate: {
    maxBytes: 32 * 1024 * 1024,
    minDimension: 64,
    maxDimension: 8192,
  },
  /** Raw text accepted per intent field before it is rejected as invalid input */
  maxRawFieldLength: 500,
  /** Clean Intent value length after normalization */
  maxCleanFieldLength: 200,
} as const;
