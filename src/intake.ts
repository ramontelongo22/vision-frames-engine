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
 * that fail the image contract, end the run before any model call. Every reference is
 * re-encoded as JPEG first (P-09): HEIC through heic.ts (O-05), other formats through
 * photo.ts, so no embedded metadata is ever sent to a provider.
 */

import { LIMITS } from './config';
import { convertHeicToJpeg, HEIC_MIME_TYPES, isHeic } from './heic';
import { ImageLimits, ReferenceImage, validateImageBytes } from './images';
import { reencodePhoto } from './photo';
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

export type ReferenceReencodeResult =
  | { ok: true; references: unknown; convertedCount: number }
  | { ok: false; reason: string };

/** The image contract applied to an upload before it is decoded */
const UPLOAD_LIMITS: ImageLimits = {
  maxBytes: LIMITS.referenceUpload.maxInputBytes,
  minDimension: LIMITS.referenceUpload.minDimension,
  maxDimension: LIMITS.referenceUpload.maxDimension,
};

/**
 * References `prepareReferences` has already validated. A board validates its references
 * once and hands the same objects to every frame's run, which must not re-encode them a
 * second time (each pass would lose JPEG quality).
 */
const PREPARED_REFERENCES = new WeakSet<object>();

/**
 * Re-encode every reference as JPEG (P-09) so `prepareReferences` can validate it and no
 * embedded metadata leaves the engine. HEIC is converted by heic.ts (O-05); JPEG, PNG and
 * WebP are first checked against the upload limits and a declared MIME type, then
 * re-encoded by photo.ts. Input that `prepareReferences` will reject anyway (not an
 * array, too many images, or an entry without image bytes) passes through untouched, as
 * do references it has already prepared.
 */
export async function reencodeReferences(raw: unknown): Promise<ReferenceReencodeResult> {
  if (!Array.isArray(raw) || raw.length > LIMITS.maxReferenceImages) {
    return { ok: true, references: raw, convertedCount: 0 };
  }

  const references: unknown[] = [];
  let convertedCount = 0;
  for (let i = 0; i < raw.length; i++) {
    const entry = raw[i] as { bytes?: unknown; mimeType?: unknown } | null;
    if (
      typeof entry !== 'object' ||
      entry === null ||
      PREPARED_REFERENCES.has(entry) ||
      !(entry.bytes instanceof Uint8Array)
    ) {
      references.push(entry);
      continue;
    }

    if (isHeic(entry.bytes)) {
      const declared = entry.mimeType;
      if (
        declared !== undefined &&
        declared !== null &&
        (typeof declared !== 'string' || !HEIC_MIME_TYPES.has(declared.split(';')[0].trim().toLowerCase()))
      ) {
        return { ok: false, reason: `reference ${i + 1} failed validation: mime_mismatch` };
      }
      const converted = await convertHeicToJpeg(entry.bytes);
      if (!converted.ok) {
        return { ok: false, reason: `reference ${i + 1} failed validation: heic_${converted.error}` };
      }
      references.push({ bytes: converted.bytes, mimeType: 'image/jpeg' });
      convertedCount++;
      continue;
    }

    const upload = validateImageBytes(entry.bytes, entry.mimeType, UPLOAD_LIMITS);
    if (!upload.ok) {
      return { ok: false, reason: `reference ${i + 1} failed validation: ${upload.error}` };
    }
    const reencoded = await reencodePhoto(entry.bytes);
    if (!reencoded.ok) {
      return { ok: false, reason: `reference ${i + 1} failed validation: ${reencoded.error}` };
    }
    references.push({ bytes: reencoded.bytes, mimeType: 'image/jpeg' });
    convertedCount++;
  }

  return { ok: true, references, convertedCount };
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
    const reference: ReferenceImage = { ...result.image, id: `ref-${i + 1}` };
    PREPARED_REFERENCES.add(reference);
    references.push(reference);
  }

  return { ok: true, references };
}
