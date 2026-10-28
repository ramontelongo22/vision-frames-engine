/**
 * Vision Frames v1 - Refinement Requests
 * Single source of truth: spec/VisionFrames_v1.pdf Section 7 and System Flow step 6
 *
 * Refinements allowed only for:
 * - Lighting
 * - Environment tone
 * - Minor framing (still wide)
 *
 * Never refine: face, body, pose, action, identity.
 *
 * Refinement text is system-owned. Nothing the user or the analyzer writes is ever
 * passed through; the analyzer may only select one of the categories below.
 */

export const REFINEMENT_TYPES = ['lighting', 'environment_tone', 'minor_framing'] as const;

export type RefinementType = (typeof REFINEMENT_TYPES)[number];

const REFINEMENT_INSTRUCTIONS: Record<RefinementType, string> = {
  lighting:
    'Edit the provided image. Adjust only the lighting so it is controlled and cinematic, favoring night, dusk, or low-key interior light.',
  environment_tone:
    'Edit the provided image. Adjust only the color and tonal atmosphere of the environment so the scene feels grounded, real, and contemporary.',
  minor_framing:
    'Edit the provided image. Make only a minor framing adjustment. The framing must stay medium-wide to wide, eye-level or slightly low.',
};

const PRESERVE_INSTRUCTION =
  'Do not change the face, body proportions, pose, action, or identity of the person. Do not add or remove people or objects.';

/**
 * Build the edit prompt for one refinement. The canonical prompt is appended unchanged
 * so every restriction still applies to the edited image.
 */
export function buildRefinementPrompt(type: RefinementType, canonicalPrompt: string): string {
  return [REFINEMENT_INSTRUCTIONS[type], PRESERVE_INSTRUCTION, canonicalPrompt].join('\n\n');
}
