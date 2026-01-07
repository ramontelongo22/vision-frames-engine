/**
 * Vision Frames v1 - Configuration
 * Single source of truth: /spec/VisionFrames_v1.pdf Section 7
 *
 * Hard-coded limits per specification
 */

export const CONFIG = {
  /**
   * Maximum generation attempts (PDF Section 7)
   */
  maxGenerations: 3,

  /**
   * Maximum refinement attempts (PDF Section 7)
   */
  maxRefinements: 2,
} as const;
