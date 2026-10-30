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
  /**
   * iPhone HEIC references are converted to JPEG before the reference contract runs
   * (O-05). The input cap is larger than `reference.maxBytes` because conversion
   * downscales; the converted JPEG must still pass `reference`.
   */
  heicReference: {
    maxInputBytes: 20 * 1024 * 1024,
    /** Refuse to decode anything larger; a 48 MP iPhone photo is 8064 x 6048, about 48.8 M pixels */
    maxPixels: 50_000_000,
    /** Longest side after conversion; the analyzer's high-detail input is 2048 px */
    maxOutputDimension: 2048,
    jpegQuality: 90,
  },
  /** Raw text accepted per intent field before it is rejected as invalid input */
  maxRawFieldLength: 500,
  /** Clean Intent value length after normalization */
  maxCleanFieldLength: 200,
} as const;

/**
 * v2 boards (docs/DECISIONS.md V2-02). The sizes are the owner's decision; everything
 * else is a provisional engineering setting to confirm after the live test.
 */
export const BOARD = {
  sizes: [3, 7, 9],
  /** Frames running at once; proposed as 3 until the live test shows provider limits */
  concurrency: 3,
  image: {
    /** Each frame is scaled to fill a 16:9 cell this wide; overflow is cropped evenly */
    cellWidth: 960,
    cellAspect: 16 / 9,
    gutter: 24,
    margin: 48,
    /** RGB, warm off-white */
    background: [245, 243, 238],
    jpegQuality: 90,
  },
} as const;
