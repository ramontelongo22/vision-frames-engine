/**
 * Vision Frames v1 - Intake Boundary
 * Single source of truth: spec/VisionFrames_v1.pdf Section 3 and System Flow steps 0-1
 *
 * Inputs available:
 * - Reference images (required)
 * - Identity direction (required), environment (optional), mood (optional)
 *
 * Fields outside the contract are not accepted: they are dropped silently and never
 * reach normalization or the prompt. Values of the wrong type, or reference images
 * that fail the image contract, end the run before any model call.
 */

import { LIMITS } from './config';
import { ReferenceImage, validateImageBytes } from './images';
import { INTENT_FIELDS, RawInput } from './schema';

export type IntakeResult =
  | { ok: true; input: RawInput; droppedFieldCount: number }
  | { ok: false; reason: string };

export function validateRawInput(raw: unknown): IntakeResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, reason: 'input is not an object' };
  }
  const record = raw as Record<string, unknown>;

  const identity = record.identityDirection;
  if (typeof identity !== 'string') {
    return { ok: false, reason: 'identityDirection is required and must be a string' };
  }

  const input: RawInput = { identityDirection: identity };

  for (const field of ['environmentPreference', 'moodTone'] as const) {
    const value = record[field];
    if (value === undefined || value === null) {
      continue;
    }
    if (typeof value !== 'string') {
      return { ok: false, reason: `${field} must be a string when provided` };
    }
    input[field] = value;
  }

  for (const field of INTENT_FIELDS) {
    const value = input[field];
    if (value !== undefined && value.length > LIMITS.maxRawFieldLength) {
      return { ok: false, reason: `${field} exceeds the maximum length` };
    }
  }

  const droppedFieldCount = Object.keys(record).filter(
    (key) => !(INTENT_FIELDS as readonly string[]).includes(key)
  ).length;

  return { ok: true, input, droppedFieldCount };
}

export type ReferenceIntakeResult =
  | { ok: true; references: ReferenceImage[] }
  | { ok: false; reason: string };

/**
 * Validate reference images. Each entry must provide real image bytes; a declared
 * mimeType, if present, must match the bytes. File names and other metadata are ignored.
 */
export function prepareReferences(raw: unknown): ReferenceIntakeResult {
  if (!Array.isArray(raw)) {
    return { ok: false, reason: 'references must be an array' };
  }
  if (raw.length < LIMITS.minReferenceImages) {
    return { ok: false, reason: 'reference images are required' };
  }
  if (raw.length > LIMITS.maxReferenceImages) {
    return { ok: false, reason: 'too many reference images' };
  }

  const references: ReferenceImage[] = [];
  for (let i = 0; i < raw.length; i++) {
    const entry = raw[i] as { bytes?: unknown; mimeType?: unknown } | null;
    if (typeof entry !== 'object' || entry === null) {
      return { ok: false, reason: `reference ${i + 1} is not an image object` };
    }
    const result = validateImageBytes(entry.bytes, entry.mimeType, LIMITS.reference);
    if (!result.ok) {
      return { ok: false, reason: `reference ${i + 1} failed validation: ${result.error}` };
    }
    references.push({ ...result.image, id: `ref-${i + 1}` });
  }

  return { ok: true, references };
}
