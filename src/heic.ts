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

export interface RgbaImage {
  width: number;
  height: number;
  /** RGBA, 4 bytes per pixel */
  data: Uint8Array | Uint8ClampedArray;
}

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
 * Shrink an RGBA image so its longest side is at most `maxDimension`, averaging the
 * source pixels under each output pixel. Images already within the limit are returned
 * unchanged.
 */
export function downscaleRgba(source: RgbaImage, maxDimension: number): RgbaImage {
  const scale = maxDimension / Math.max(source.width, source.height);
  if (scale >= 1) {
    return source;
  }
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));
  const data = new Uint8Array(width * height * 4);
  // A plain Uint8Array view keeps the inner loop monomorphic whatever array type came in
  const pixels = new Uint8Array(source.data.buffer, source.data.byteOffset, source.data.byteLength);
  const xRatio = source.width / width;
  const yRatio = source.height / height;

  for (let y = 0; y < height; y++) {
    const y0 = Math.floor(y * yRatio);
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * yRatio));
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor(x * xRatio);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * xRatio));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = y0; sy < y1; sy++) {
        let i = (sy * source.width + x0) * 4;
        for (let sx = x0; sx < x1; sx++, i += 4) {
          r += pixels[i];
          g += pixels[i + 1];
          b += pixels[i + 2];
          a += pixels[i + 3];
        }
      }
      const count = (y1 - y0) * (x1 - x0);
      const o = (y * width + x) * 4;
      data[o] = Math.round(r / count);
      data[o + 1] = Math.round(g / count);
      data[o + 2] = Math.round(b / count);
      data[o + 3] = Math.round(a / count);
    }
  }
  return { width, height, data };
}

/**
 * Decode a HEIC image and re-encode it as JPEG, downscaled to the output limit.
 * Never throws.
 */
export async function convertHeicToJpeg(
  bytes: Uint8Array,
  limits: HeicLimits = LIMITS.heicReference
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
