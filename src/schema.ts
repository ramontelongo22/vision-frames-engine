/**
 * Vision Frames v1 - Clean Intent Schema
 * Single source of truth: /spec/VisionFrames_v1.pdf
 */

export interface CleanIntent {
  /**
   * Required: Non-visual, non-actional identity direction
   */
  identityDirection: string;

  /**
   * Optional: Broad environment preference only
   */
  environmentPreference?: string;

  /**
   * Optional: Mood or tone
   */
  moodTone?: string;
}
