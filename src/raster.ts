/**
 * Vision Frames - RGBA raster helpers
 *
 * Shared by HEIC conversion (downscale before JPEG encoding) and the v2 board image
 * (crop and scale each frame into its cell). Pure functions over 8-bit RGBA pixels.
 */

export interface RgbaImage {
  width: number;
  height: number;
  /** RGBA, 4 bytes per pixel */
  data: Uint8Array | Uint8ClampedArray;
}

/** A pixel rectangle inside an image */
export interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The largest centred region of a `width` x `height` image with the given aspect ratio
 * (width / height). Scaling that region to a cell of the same ratio fills the cell with
 * no stretching; whatever lies outside it is cropped.
 */
export function coverRegion(width: number, height: number, aspect: number): Region {
  if (width / height > aspect) {
    const cropWidth = Math.max(1, Math.min(width, Math.round(height * aspect)));
    return { x: Math.floor((width - cropWidth) / 2), y: 0, width: cropWidth, height };
  }
  const cropHeight = Math.max(1, Math.min(height, Math.round(width / aspect)));
  return { x: 0, y: Math.floor((height - cropHeight) / 2), width, height: cropHeight };
}

/**
 * Scale `region` of `source` to `width` x `height`. Shrinking averages the source pixels
 * under each output pixel; enlarging interpolates bilinearly between the nearest four.
 */
export function resampleRgba(source: RgbaImage, region: Region, width: number, height: number): RgbaImage {
  const data = new Uint8Array(width * height * 4);
  // A plain Uint8Array view keeps the inner loops monomorphic whatever array type came in
  const pixels = new Uint8Array(source.data.buffer, source.data.byteOffset, source.data.byteLength);
  const xRatio = region.width / width;
  const yRatio = region.height / height;

  if (xRatio >= 1 && yRatio >= 1) {
    for (let y = 0; y < height; y++) {
      const y0 = region.y + Math.floor(y * yRatio);
      const y1 = Math.max(y0 + 1, region.y + Math.floor((y + 1) * yRatio));
      for (let x = 0; x < width; x++) {
        const x0 = region.x + Math.floor(x * xRatio);
        const x1 = Math.max(x0 + 1, region.x + Math.floor((x + 1) * xRatio));
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

  const xMax = region.x + region.width - 1;
  const yMax = region.y + region.height - 1;
  for (let y = 0; y < height; y++) {
    const sy = Math.min(yMax, Math.max(region.y, region.y + (y + 0.5) * yRatio - 0.5));
    const y0 = Math.floor(sy);
    const y1 = Math.min(yMax, y0 + 1);
    const fy = sy - y0;
    for (let x = 0; x < width; x++) {
      const sx = Math.min(xMax, Math.max(region.x, region.x + (x + 0.5) * xRatio - 0.5));
      const x0 = Math.floor(sx);
      const x1 = Math.min(xMax, x0 + 1);
      const fx = sx - x0;
      const i00 = (y0 * source.width + x0) * 4;
      const i01 = (y0 * source.width + x1) * 4;
      const i10 = (y1 * source.width + x0) * 4;
      const i11 = (y1 * source.width + x1) * 4;
      const o = (y * width + x) * 4;
      for (let c = 0; c < 4; c++) {
        const top = pixels[i00 + c] + (pixels[i01 + c] - pixels[i00 + c]) * fx;
        const bottom = pixels[i10 + c] + (pixels[i11 + c] - pixels[i10 + c]) * fx;
        data[o + c] = Math.round(top + (bottom - top) * fy);
      }
    }
  }
  return { width, height, data };
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
  return resampleRgba(source, { x: 0, y: 0, width: source.width, height: source.height }, width, height);
}
