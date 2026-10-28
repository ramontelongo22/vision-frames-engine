/**
 * Vision Frames v1 - Clean Intent Schema
 * Single source of truth: spec/VisionFrames_v1.pdf (Section 3, System Flow steps 1-2)
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

/**
 * The only intent fields a user may submit (System Flow step 1). Anything else is
 * not accepted as a field.
 */
export interface RawInput {
  identityDirection: string;
  environmentPreference?: string;
  moodTone?: string;
}

export const INTENT_FIELDS: ReadonlyArray<keyof RawInput> = [
  'identityDirection',
  'environmentPreference',
  'moodTone',
];
