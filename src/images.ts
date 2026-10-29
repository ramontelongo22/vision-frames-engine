/**
 * Vision Frames v1 - Image Contracts
 * Single source of truth: spec/VisionFrames_v1.pdf (System Flow 0 and 4: reference images required)
 *
 * Every image that crosses an engine boundary (user references in, model candidates out)
 * is checked here: real bytes, a recognised format sniffed from the bytes themselves,
 * and readable dimensions. The format is never inferred from a missing MIME field.
 *
 * This is a structural check (signature + header dimensions), not a full decode.
 */

export type ImageMimeType = 'image/png' | 'image/jpeg' | 'image/webp';

export interface ValidatedImage {
  readonly bytes: Uint8Array;
  readonly mimeType: ImageMimeType;
  readonly width: number;
  readonly height: number;
}

export interface ReferenceImage extends ValidatedImage {
  readonly id: string;
}

export interface CandidateImage extends ValidatedImage {
  readonly id: string;
  readonly origin: 'generation' | 'refinement';
  /** For refinements: the id of the QA-passing base image that was edited */
  readonly baseId?: string;
}

/**
 * What a provider adapter hands back: raw bytes plus the MIME type the provider declared.
 * The engine validates it before it becomes a CandidateImage.
 */
export interface ImagePayload {
  bytes: Uint8Array;
  mimeType?: string;
}

export interface ImageLimits {
  maxBytes: number;
  minDimension: number;
  maxDimension: number;
}

export type ImageValidationError =
  | 'not_binary'
  | 'empty'
  | 'too_large'
  | 'unsupported_format'
  | 'mime_mismatch'
  | 'unreadable_dimensions'
  | 'dimensions_out_of_range';

export type ImageValidation =
  | { ok: true; image: ValidatedImage }
  | { ok: false; error: ImageValidationError };

/**
 * Validate raw image bytes against the image contract.
 * A declared MIME type, when present, must agree with the sniffed format.
 */
export function validateImageBytes(
  bytes: unknown,
  declaredMimeType: unknown,
  limits: ImageLimits
): ImageValidation {
  if (!(bytes instanceof Uint8Array)) {
    return { ok: false, error: 'not_binary' };
  }
  if (bytes.length === 0) {
    return { ok: false, error: 'empty' };
  }
  if (bytes.length > limits.maxBytes) {
    return { ok: false, error: 'too_large' };
  }

  const sniffed = sniffFormat(bytes);
  if (!sniffed) {
    return { ok: false, error: 'unsupported_format' };
  }

  if (declaredMimeType !== undefined && declaredMimeType !== null) {
    if (typeof declaredMimeType !== 'string' || normalizeMime(declaredMimeType) !== sniffed) {
      return { ok: false, error: 'mime_mismatch' };
    }
  }

  const dimensions = readDimensions(bytes, sniffed);
  if (!dimensions) {
    return { ok: false, error: 'unreadable_dimensions' };
  }

  const { width, height } = dimensions;
  if (
    width < limits.minDimension ||
    height < limits.minDimension ||
    width > limits.maxDimension ||
    height > limits.maxDimension
  ) {
    return { ok: false, error: 'dimensions_out_of_range' };
  }

  return { ok: true, image: { bytes, mimeType: sniffed, width, height } };
}

function normalizeMime(mime: string): string {
  const base = mime.split(';')[0].trim().toLowerCase();
  return base === 'image/jpg' ? 'image/jpeg' : base;
}

function sniffFormat(b: Uint8Array): ImageMimeType | null {
  if (
    b.length >= 8 &&
    b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
    b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    return 'image/jpeg';
  }
  if (b.length >= 12 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

function readDimensions(
  b: Uint8Array,
  format: ImageMimeType
): { width: number; height: number } | null {
  switch (format) {
    case 'image/png':
      return readPngDimensions(b);
    case 'image/jpeg':
      return readJpegDimensions(b);
    case 'image/webp':
      return readWebpDimensions(b);
  }
}

function readPngDimensions(b: Uint8Array): { width: number; height: number } | null {
  // Signature (8) + IHDR length (4) + "IHDR" (4) + width (4) + height (4)
  if (b.length < 24 || ascii(b, 12, 4) !== 'IHDR') {
    return null;
  }
  return { width: u32be(b, 16), height: u32be(b, 20) };
}

function readJpegDimensions(b: Uint8Array): { width: number; height: number } | null {
  let offset = 2;
  while (offset + 3 < b.length) {
    if (b[offset] !== 0xff) {
      return null;
    }
    let marker = b[offset + 1];
    // Skip fill bytes
    while (marker === 0xff && offset + 2 < b.length) {
      offset++;
      marker = b[offset + 1];
    }
    offset += 2;
    // Standalone markers carry no length
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) {
      // End of image or start of scan before any frame header
      return null;
    }
    if (offset + 2 > b.length) {
      return null;
    }
    const segmentLength = u16be(b, offset);
    if (segmentLength < 2) {
      return null;
    }
    const isStartOfFrame =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isStartOfFrame) {
      if (offset + 7 > b.length) {
        return null;
      }
      return { height: u16be(b, offset + 3), width: u16be(b, offset + 5) };
    }
    offset += segmentLength;
  }
  return null;
}

function readWebpDimensions(b: Uint8Array): { width: number; height: number } | null {
  if (b.length < 30) {
    return null;
  }
  const chunk = ascii(b, 12, 4);
  if (chunk === 'VP8 ') {
    // Frame tag (3) then start code 9d 01 2a, then 14-bit width/height
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) {
      return null;
    }
    return { width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff };
  }
  if (chunk === 'VP8L') {
    if (b[20] !== 0x2f) {
      return null;
    }
    const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8X') {
    return { width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 };
  }
  return null;
}

function ascii(b: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...b.subarray(start, start + length));
}

function u16be(b: Uint8Array, i: number): number {
  return (b[i] << 8) | b[i + 1];
}

function u16le(b: Uint8Array, i: number): number {
  return b[i] | (b[i + 1] << 8);
}

function u24le(b: Uint8Array, i: number): number {
  return b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
}

function u32be(b: Uint8Array, i: number): number {
  return ((b[i] << 24) >>> 0) + ((b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]);
}
