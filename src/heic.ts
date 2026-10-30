/**
 * Vision Frames v1 - HEIC reference conversion
 *
 * iPhones save photos as HEIC by default. A HEIC reference is decoded and re-encoded as
 * JPEG before the reference image contract runs, so every provider receives a format it
 * accepts (O-05). Re-encoding from pixels drops all embedded metadata, including EXIF
 * location. Only the first top-level image in the file is used.
 *
 * Decoding uses libheif compiled to WebAssembly (heic-decode, LGPL-3.0 libheif-js), loaded
 * on first use so callers that never see HEIC do not pay for it.
 */

import { encode as encodeJpeg } from 'jpeg-js';
import { LIMITS } from './config';
import { RgbaImage, downscaleRgba } from './raster';

/** ISO BMFF brands that identify HEVC-coded HEIF images and sequences */
const HEVC_BRANDS = new Set(['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'hevm', 'hevs']);

export const HEIC_MIME_TYPES: ReadonlySet<string> = new Set(['image/heic', 'image/heif']);

export interface HeicLimits {
  maxInputBytes: number;
  maxPixels: number;
  maxOutputDimension: number;
  jpegQuality: number;
}

export type HeicConversionError = 'too_large' | 'decode_failed';

export type HeicConversion =
  | { ok: true; bytes: Uint8Array; width: number; height: number }
  | { ok: false; error: HeicConversionError };

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.subarray(start, end));
}

/**
 * True when the bytes start with an ISO BMFF `ftyp` box naming an HEVC brand, either as
 * the major brand or a compatible one. AVIF and other non-HEVC HEIF files are not HEIC.
 */
export function isHeic(bytes: Uint8Array): boolean {
  if (bytes.length < 16 || ascii(bytes, 4, 8) !== 'ftyp') {
    return false;
  }
  const boxSize = ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
  const end = Math.min(boxSize, bytes.length);
  const brands = [ascii(bytes, 8, 12)];
  for (let offset = 16; offset + 4 <= end; offset += 4) {
    brands.push(ascii(bytes, offset, offset + 4));
  }
  return brands.some((brand) => HEVC_BRANDS.has(brand));
}

/**
 * Decode a HEIC image and re-encode it as JPEG, downscaled to the output limit.
 * Never throws.
 */
export async function convertHeicToJpeg(
  bytes: Uint8Array,
  limits: HeicLimits = LIMITS.referenceUpload
): Promise<HeicConversion> {
  if (bytes.length > limits.maxInputBytes) {
    return { ok: false, error: 'too_large' };
  }

  let decoded: RgbaImage;
  try {
    const { default: decodeHeic } = await import('heic-decode');
    const images = await decodeHeic.all({ buffer: bytes });
    try {
      const first = images[0];
      if (first.width * first.height > limits.maxPixels) {
        return { ok: false, error: 'too_large' };
      }
      decoded = await first.decode();
    } finally {
      images.dispose();
    }
  } catch {
    return { ok: false, error: 'decode_failed' };
  }

  const resized = downscaleRgba(decoded, limits.maxOutputDimension);
  const jpeg = encodeJpeg(
    { width: resized.width, height: resized.height, data: Buffer.from(resized.data.buffer, resized.data.byteOffset, resized.data.byteLength) },
    limits.jpegQuality
  );
  return { ok: true, bytes: new Uint8Array(jpeg.data), width: resized.width, height: resized.height };
}
