/**
 * RGBA raster helpers shared by HEIC conversion and the v2 board image
 */

import { coverRegion, downscaleRgba, resampleRgba } from '../src/raster';

describe('downscaleRgba', () => {
  it('averages the source pixels under each output pixel', () => {
    // 4x2 image: left 2x2 block is 0/100/200/255, right block is 40/40/40/255
    const data = new Uint8Array(4 * 2 * 4);
    for (let y = 0; y < 2; y++) {
      for (let x = 0; x < 4; x++) {
        const o = (y * 4 + x) * 4;
        data.set(x < 2 ? [0, 100, 200, 255] : [40, 40, 40, 255], o);
      }
    }
    const out = downscaleRgba({ width: 4, height: 2, data }, 2);

    expect(out.width).toBe(2);
    expect(out.height).toBe(1);
    expect(Array.from(out.data)).toEqual([0, 100, 200, 255, 40, 40, 40, 255]);
  });

  it('returns images already within the limit unchanged', () => {
    const source = { width: 10, height: 5, data: new Uint8Array(200) };
    expect(downscaleRgba(source, 10)).toBe(source);
  });
});

describe('coverRegion', () => {
  it('crops the sides of an image wider than the target shape, evenly', () => {
    expect(coverRegion(400, 100, 16 / 9)).toEqual({ x: 111, y: 0, width: 178, height: 100 });
  });

  it('crops the top and bottom of an image taller than the target shape, evenly', () => {
    expect(coverRegion(160, 120, 16 / 9)).toEqual({ x: 0, y: 15, width: 160, height: 90 });
  });

  it('keeps an image that already has the target shape whole', () => {
    expect(coverRegion(1920, 1080, 16 / 9)).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
  });
});

describe('resampleRgba', () => {
  const ramp = (): { width: number; height: number; data: Uint8Array } => {
    // 2x1: black then white, opaque
    return { width: 2, height: 1, data: new Uint8Array([0, 0, 0, 255, 200, 200, 200, 255]) };
  };

  it('interpolates between neighbours when enlarging', () => {
    const out = resampleRgba(ramp(), { x: 0, y: 0, width: 2, height: 1 }, 4, 1);
    expect(Array.from(out.data.filter((_, i) => i % 4 === 0))).toEqual([0, 50, 150, 200]);
    expect(out.data.every((v, i) => i % 4 !== 3 || v === 255)).toBe(true);
  });

  it('reads only the requested region', () => {
    // 3x1: red, green, blue; take the middle pixel and enlarge it
    const source = { width: 3, height: 1, data: new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255]) };
    const out = resampleRgba(source, { x: 1, y: 0, width: 1, height: 1 }, 3, 2);
    for (let p = 0; p < 6; p++) {
      expect(Array.from(out.data.subarray(p * 4, p * 4 + 4))).toEqual([0, 255, 0, 255]);
    }
  });

  it('averages within the region when shrinking', () => {
    // 4x1: 10, 20 | 30, 40 (gray); region is the last three pixels shrunk to one
    const data = new Uint8Array([10, 10, 10, 255, 20, 20, 20, 255, 30, 30, 30, 255, 40, 40, 40, 255]);
    const out = resampleRgba({ width: 4, height: 1, data }, { x: 1, y: 0, width: 3, height: 1 }, 1, 1);
    expect(Array.from(out.data)).toEqual([30, 30, 30, 255]);
  });
});
