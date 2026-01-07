/**
 * Vision Frames v1 - Canonical Prompt Builder
 * Single source of truth: /spec/VisionFrames_v1.pdf Section 4
 *
 * Returns the Canonical Internal Prompt verbatim.
 * Inserts only the 3 allowed variables without changing canonical wording.
 */

import { CleanIntent } from './schema';

/**
 * Build the Canonical Internal Prompt (v1) verbatim from PDF
 * Only inserts allowed variables: identityDirection, environmentPreference, moodTone
 */
export function buildCanonicalPrompt(cleanIntent: CleanIntent): string {
  // Start with base canonical prompt - verbatim from PDF Section 4
  let prompt = `Generate a photorealistic image of the future version of the user in an identity-forward arrival moment.

The subject is a single individual, depicted in a low-action state (standing or walking only), expressing calm presence and ownership of space.

The scene must feel grounded, real, and contemporary.

Do not depict seated positions, active work, object handling, or social interaction.

Lighting is controlled and cinematic, favoring night, dusk, or low-key interiors.

Framing is medium-wide to wide, eye-level or slightly low.

Likeness must remain natural and consistent with reference images.

Success is implied through stillness and environment, never through actions, objects, or outcomes.`;

  // Insert identity direction if present
  if (cleanIntent.identityDirection) {
    prompt = `${cleanIntent.identityDirection}\n\n` + prompt;
  }

  // Insert environment preference if present
  if (cleanIntent.environmentPreference) {
    prompt += `\n\n${cleanIntent.environmentPreference}`;
  }

  // Insert mood/tone if present
  if (cleanIntent.moodTone) {
    prompt += `\n\n${cleanIntent.moodTone}`;
  }

  return prompt;
}
