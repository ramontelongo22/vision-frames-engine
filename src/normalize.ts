/**
 * Vision Frames v1 - Input Normalization
 * Single source of truth: /spec/VisionFrames_v1.pdf
 *
 * Silently strips disallowed framing words and removes:
 * - Actions/poses
 * - Objects/props
 * - Jobs/roles/outcomes
 * - Commands/instructions
 *
 * Never notifies the user.
 */

import { CleanIntent } from './schema';

/**
 * Disallowed framing words per PDF Section 2
 */
const DISALLOWED_WORDS = [
  'manifest',
  'manifestation',
  'simulation',
  'roleplay',
  'wealthy',
  'rich',
  'successful',
  'hustle',
  'grind',
  'fantasy',
  'dream life',
  'glow-up',
  'glow up',
  'upgrade',
];

/**
 * Action/pose indicators to strip
 */
const ACTION_INDICATORS = [
  'sitting',
  'seated',
  'holding',
  'working',
  'gesturing',
  'running',
  'jumping',
  'dancing',
  'exercising',
  'typing',
  'writing',
  'pointing',
  'reaching',
  'grabbing',
  'talking',
  'speaking',
  'presenting',
  'performing',
];

/**
 * Object/prop indicators to strip
 */
const OBJECT_INDICATORS = [
  'laptop',
  'computer',
  'phone',
  'book',
  'briefcase',
  'bag',
  'coffee',
  'drink',
  'food',
  'item',
  'object',
  'prop',
  'tool',
  'device',
  'equipment',
];

/**
 * Job/role/outcome indicators to strip
 */
const ROLE_OUTCOME_INDICATORS = [
  'ceo',
  'founder',
  'entrepreneur',
  'executive',
  'manager',
  'success',
  'achievement',
  'accomplishment',
  'goal',
  'promotion',
  'wealth',
  'income',
  'salary',
  'business',
  'company',
  'startup',
];

/**
 * Command/instruction indicators to strip
 */
const COMMAND_INDICATORS = [
  'make',
  'create',
  'generate',
  'show',
  'display',
  'depict',
  'illustrate',
  'draw',
  'render',
  'produce',
];

/**
 * Normalize a single field by removing disallowed content
 */
function normalizeField(input: string): string {
  let normalized = input.trim();

  // Strip disallowed framing words
  for (const word of DISALLOWED_WORDS) {
    const regex = new RegExp(`\\b${word}\\b`, 'gi');
    normalized = normalized.replace(regex, '');
  }

  // Strip action indicators
  for (const action of ACTION_INDICATORS) {
    const regex = new RegExp(`\\b${action}\\b`, 'gi');
    normalized = normalized.replace(regex, '');
  }

  // Strip object indicators
  for (const obj of OBJECT_INDICATORS) {
    const regex = new RegExp(`\\b${obj}\\b`, 'gi');
    normalized = normalized.replace(regex, '');
  }

  // Strip role/outcome indicators
  for (const role of ROLE_OUTCOME_INDICATORS) {
    const regex = new RegExp(`\\b${role}\\b`, 'gi');
    normalized = normalized.replace(regex, '');
  }

  // Strip command indicators
  for (const cmd of COMMAND_INDICATORS) {
    const regex = new RegExp(`\\b${cmd}\\b`, 'gi');
    normalized = normalized.replace(regex, '');
  }

  // Clean up extra whitespace
  normalized = normalized.replace(/\s+/g, ' ').trim();

  return normalized;
}

/**
 * Normalize user input into Clean Intent
 * Silently strips all disallowed content per PDF Section 3
 */
export function normalize(input: {
  identityDirection: string;
  environmentPreference?: string;
  moodTone?: string;
}): CleanIntent {
  const cleanIntent: CleanIntent = {
    identityDirection: normalizeField(input.identityDirection),
  };

  if (input.environmentPreference) {
    const normalized = normalizeField(input.environmentPreference);
    if (normalized) {
      cleanIntent.environmentPreference = normalized;
    }
  }

  if (input.moodTone) {
    const normalized = normalizeField(input.moodTone);
    if (normalized) {
      cleanIntent.moodTone = normalized;
    }
  }

  return cleanIntent;
}
