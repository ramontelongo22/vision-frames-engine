/**
 * Vision Frames v1 - Semantic Normalization (LLM step)
 * Single source of truth: spec/VisionFrames_v1.pdf System Flow step 2
 *
 * "LLM transforms user inputs -> Clean Intent". The model's output is untrusted: it must
 * be exactly the three Clean Intent fields as strings, and it still passes through the
 * deterministic floor in normalize.ts before it can reach the prompt.
 */

import { LIMITS } from './config';
import { Validation } from './qaGate';
import { CleanIntent, INTENT_FIELDS, RawInput } from './schema';

export interface SemanticNormalizer {
  /**
   * Return a candidate Clean Intent for the given raw input. The engine validates the
   * returned value; adapters should throw ProviderError on transport failures.
   */
  normalize(input: RawInput, options?: { signal?: AbortSignal }): Promise<unknown>;
}

/**
 * Validate a semantic normalizer's output. Every key must be one of the three Clean
 * Intent fields; each value must be a string (empty string means "nothing safe kept").
 */
export function validateSemanticOutput(raw: unknown): Validation<CleanIntent> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { valid: false, reason: 'semantic output is not an object' };
  }
  const record = raw as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!(INTENT_FIELDS as readonly string[]).includes(key)) {
      return { valid: false, reason: `unexpected semantic output field: ${key}` };
    }
  }
  for (const field of INTENT_FIELDS) {
    const value = record[field];
    if (typeof value !== 'string') {
      return { valid: false, reason: `semantic output field ${field} must be a string` };
    }
    if (value.length > LIMITS.maxRawFieldLength) {
      return { valid: false, reason: `semantic output field ${field} is too long` };
    }
  }

  const intent: CleanIntent = { identityDirection: record.identityDirection as string };
  if (record.environmentPreference) {
    intent.environmentPreference = record.environmentPreference as string;
  }
  if (record.moodTone) {
    intent.moodTone = record.moodTone as string;
  }
  return { valid: true, value: intent };
}
