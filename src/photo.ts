/**
 * Vision Frames - reference photo re-encoding
 *
 * Every JPEG, PNG or WebP reference is decoded and written again as a fresh JPEG before
 * the reference contract runs (P-09). Re-encoding from pixels:
 * - applies the photo's EXIF orientation, so a phone photo arrives upright, then drops it;
 * - drops every other piece of embedded metadata (EXIF, including GPS location and camera
 *   serial numbers, XMP, IPTC, comments), so none of it reaches a provider;
 * - shrinks the longest side to the output limit, so full-resolution phone photos are
 *   accepted instead of rejected.
 * Transparency is flattened onto white. HEIC goes through heic.ts instead, because the
 * prebuilt libvips in sharp does not decode HEVC.
 */

import sharp from 'sharp';
import { LIMITS } from './config';

export interface PhotoLimits {
  maxInputBytes: number;
  maxPixels: number;
  maxOutputDimension: number;
  jpegQuality: number;
}

export type PhotoReencodeError = 'too_large' | 'decode_failed';

export type PhotoReencode =
  | { ok: true; bytes: Uint8Array; width: number; height: number }
  | { ok: false; error: PhotoReencodeError };

/**
 * Decode a JPEG, PNG or WebP photo and re-encode it as an upright, metadata-free JPEG,
 * downscaled to the output limit. Never throws.
 */
export async function reencodePhoto(
  bytes: Uint8Array,
  limits: PhotoLimits = LIMITS.referenceUpload
): Promise<PhotoReencode> {
  if (bytes.length > limits.maxInputBytes) {
    return { ok: false, error: 'too_large' };
  }

  try {
    const { data, info } = await sharp(bytes, { limitInputPixels: limits.maxPixels })
      .autoOrient()
      .resize({
        width: limits.maxOutputDimension,
        height: limits.maxOutputDimension,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: limits.jpegQuality })
      .toBuffer({ resolveWithObject: true });
    return { ok: true, bytes: new Uint8Array(data), width: info.width, height: info.height };
  } catch (error) {
    // sharp refuses images over limitInputPixels before decoding them
    if (error instanceof Error && /pixel limit/i.test(error.message)) {
      return { ok: false, error: 'too_large' };
    }
    return { ok: false, error: 'decode_failed' };
  }
}
