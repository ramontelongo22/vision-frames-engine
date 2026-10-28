/**
 * Vision Frames v1 - Canonical Prompt Builder
 * Single source of truth: spec/VisionFrames_v1.pdf Section 4 and System Flow step 3
 *
 * Returns the Canonical Internal Prompt verbatim.
 * Inserts only the 3 allowed variables without changing canonical wording.
 *
 * Serialization (implementation clarification, docs/DECISIONS.md P-07): the canonical
 * core always comes first and is never edited. Each allowed variable follows on its own
 * labeled line, collapsed to a single line so a value cannot open a new section.
 * Empty variables are omitted.
 */

import { CleanIntent } from './schema';

/**
 * Canonical Internal Prompt (v1), verbatim from PDF Section 4.
 * PDF line wrapping is presentation; sentences are separated by blank lines.
 * "Success" in the final sentence is canonical text and is kept as written (handoff D10).
 */
export const CANONICAL_PROMPT_V1 = `Generate a photorealistic image of the future version of the user in an identity-forward arrival moment.

The subject is a single individual, depicted in a low-action state (standing or walking only), expressing calm presence and ownership of space.

The scene must feel grounded, real, and contemporary.

Do not depict seated positions, active work, object handling, or social interaction.

Lighting is controlled and cinematic, favoring night, dusk, or low-key interiors.

Framing is medium-wide to wide, eye-level or slightly low.

Likeness must remain natural and consistent with reference images.

Success is implied through stillness and environment, never through actions, objects, or outcomes.`;

const VARIABLE_LABELS: ReadonlyArray<readonly [keyof CleanIntent, string]> = [
  ['identityDirection', 'Identity direction'],
  ['environmentPreference', 'Environment preference'],
  ['moodTone', 'Mood/tone'],
];

/**
 * Build the Canonical Internal Prompt (v1) verbatim from PDF
 * Only inserts allowed variables: identityDirection, environmentPreference, moodTone
 */
export function buildCanonicalPrompt(cleanIntent: CleanIntent): string {
  const variableLines: string[] = [];

  for (const [key, label] of VARIABLE_LABELS) {
    const value = toSingleLine(cleanIntent[key]);
    if (value) {
      variableLines.push(`${label}: ${value}`);
    }
  }

  if (variableLines.length === 0) {
    return CANONICAL_PROMPT_V1;
  }

  return `${CANONICAL_PROMPT_V1}\n\n${variableLines.join('\n')}`;
}

function toSingleLine(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }
  return value.replace(/\s+/g, ' ').trim();
}
