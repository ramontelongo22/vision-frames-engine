/**
 * v2 board image: grid geometry and composed pixels (V2-02)
 */

import { decode as decodeJpeg, encode as encodeJpeg } from 'jpeg-js';
import { PNG } from 'pngjs';
import { BoardImageOptions, FrameImage, boardGeometry, composeBoard } from '../src/boardImage';
import { webpVp8x } from './helpers';

type Rgb = [number, number, number];

const BACKGROUND: Rgb = [245, 243, 238];
const SMALL: BoardImageOptions = {
  cellWidth: 64,
  cellAspect: 16 / 9,
  gutter: 4,
  margin: 8,
  background: BACKGROUND,
  jpegQuality: 95,
};

const COLORS: Rgb[] = [
  [220, 30, 30],
  [30, 200, 30],
  [30, 30, 220],
  [220, 200, 30],
  [30, 200, 200],
  [200, 30, 200],
  [120, 60, 20],
  [20, 20, 20],
  [140, 140, 140],
];

/** RGBA PNG; `paint` returns the colour and alpha of each pixel */
function rgbaPng(width: number, height: number, paint: (x: number, y: number) => [number, number, number, number]): FrameImage {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      png.data.set(paint(x, y), (y * width + x) * 4);
    }
  }
  return { bytes: new Uint8Array(PNG.sync.write(png)), mimeType: 'image/png' };
}

function solidPng(rgb: Rgb, width = 160, height = 90): FrameImage {
  return rgbaPng(width, height, () => [...rgb, 255]);
}

function decode(bytes: Uint8Array): { width: number; height: number; at: (x: number, y: number) => number[] } {
  const image = decodeJpeg(Buffer.from(bytes), { useTArray: true });
  return {
    width: image.width,
    height: image.height,
    at: (x, y) => Array.from(image.data.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 3)),
  };
}

function expectColor(actual: number[], expected: readonly number[], tolerance = 10): void {
  actual.forEach((value, i) => expect(Math.abs(value - expected[i])).toBeLessThanOrEqual(tolerance));
}

describe('boardGeometry', () => {
  const rowsOf = (count: number): number[] => {
    const geometry = boardGeometry(count, SMALL);
    if (!geometry) throw new Error('no geometry');
    const counts = new Map<number, number>();
    for (const cell of geometry.cells) counts.set(cell.y, (counts.get(cell.y) ?? 0) + 1);
    return [...counts.values()];
  };

  it.each([
    [2, [2]],
    [3, [3]],
    [4, [2, 2]],
    [5, [3, 2]],
    [6, [3, 3]],
    [7, [4, 3]],
    [8, [4, 4]],
    [9, [3, 3, 3]],
  ])('lays out %i frames in rows of %j', (count, rows) => {
    expect(rowsOf(count)).toEqual(rows);
  });

  it('makes no board image layout for 1 frame or more than 9', () => {
    expect(boardGeometry(1, SMALL)).toBeUndefined();
    expect(boardGeometry(10, SMALL)).toBeUndefined();
  });

  it('uses 16:9 cells with even gutters and margins, and centres a shorter row', () => {
    const geometry = boardGeometry(7, SMALL);
    if (!geometry) throw new Error('no geometry');
    const { width, height, cells } = geometry;

    expect(geometry.cellHeight).toBe(36);
    expect(width).toBe(8 * 2 + 4 * 64 + 3 * 4);
    expect(height).toBe(8 * 2 + 2 * 36 + 4);
    expect(cells.slice(0, 4).map((c) => c.x)).toEqual([8, 76, 144, 212]);
    expect(cells.slice(0, 4).every((c) => c.y === 8)).toBe(true);
    // Second row of 3 is centred: (284 - 200) / 2 = 42
    expect(cells.slice(4).map((c) => c.x)).toEqual([42, 110, 178]);
    expect(cells.slice(4).every((c) => c.y === 48)).toBe(true);
  });

  it('defaults to 960 px cells: a full 9-frame board is 3024 x 1764', () => {
    expect(boardGeometry(9)).toMatchObject({ width: 3024, height: 1764, cellWidth: 960, cellHeight: 540 });
    expect(boardGeometry(7)).toMatchObject({ width: 4008, height: 1200 });
    expect(boardGeometry(3)).toMatchObject({ width: 3024, height: 636 });
  });
});

describe('composeBoard', () => {
  it('places each frame in its cell, in order, on the background', () => {
    for (const count of [2, 3, 5, 7, 9]) {
      const frames = COLORS.slice(0, count).map((rgb) => solidPng(rgb));
      const result = composeBoard(frames, SMALL);
      if (!result.ok) throw new Error(result.error);
      const geometry = boardGeometry(count, SMALL);
      if (!geometry) throw new Error('no geometry');

      expect(result.image.mimeType).toBe('image/jpeg');
      const image = decode(result.image.bytes);
      expect([image.width, image.height]).toEqual([geometry.width, geometry.height]);
      geometry.cells.forEach((cell, i) => {
        expectColor(image.at(cell.x + cell.width / 2, cell.y + cell.height / 2), COLORS[i]);
        expectColor(image.at(cell.x + 3, cell.y + 3), COLORS[i], 16);
      });
      // Margin corner and the gutter after the first cell show the background
      expectColor(image.at(2, 2), BACKGROUND, 6);
      const first = geometry.cells[0];
      expectColor(image.at(first.x + first.width + 2, first.y + first.height / 2), BACKGROUND, 12);
    }
  });

  it('fills a cell with a frame of another shape by cropping it evenly, without stretching', () => {
    // 4:1 frame: red outer bands, green middle. Covering a 16:9 cell keeps the middle 178 px.
    const wide = rgbaPng(400, 100, (x) => (x < 100 || x >= 300 ? [220, 30, 30, 255] : [30, 200, 30, 255]));
    // 4:3 frame: blue top and bottom bands 15 px tall, white middle; covering crops them away
    const tall = rgbaPng(160, 120, (_, y) => (y < 15 || y >= 105 ? [30, 30, 220, 255] : [250, 250, 250, 255]));
    const result = composeBoard([wide, tall], SMALL);
    if (!result.ok) throw new Error(result.error);
    const [a, b] = boardGeometry(2, SMALL)?.cells ?? [];
    const image = decode(result.image.bytes);

    for (const x of [a.x + 2, a.x + a.width / 2, a.x + a.width - 3]) {
      expectColor(image.at(x, a.y + a.height / 2), [30, 200, 30], 16);
    }
    for (const y of [b.y + 2, b.y + b.height / 2, b.y + b.height - 3]) {
      expectColor(image.at(b.x + b.width / 2, y), [250, 250, 250], 16);
    }
  });

  it('flattens transparency onto the background', () => {
    const clear = rgbaPng(160, 90, () => [0, 0, 0, 0]);
    const half = rgbaPng(160, 90, () => [0, 0, 0, 128]);
    const result = composeBoard([clear, half], SMALL);
    if (!result.ok) throw new Error(result.error);
    const [a, b] = boardGeometry(2, SMALL)?.cells ?? [];
    const image = decode(result.image.bytes);

    expectColor(image.at(a.x + 32, a.y + 18), BACKGROUND, 6);
    expectColor(image.at(b.x + 32, b.y + 18), BACKGROUND.map((v) => Math.round(v * (127 / 255))), 8);
  });

  it('reads JPEG frames as well as PNG', () => {
    const data = Buffer.alloc(160 * 90 * 4);
    for (let i = 0; i < data.length; i += 4) data.set([30, 30, 220, 255], i);
    const jpeg: FrameImage = { bytes: new Uint8Array(encodeJpeg({ width: 160, height: 90, data }, 95).data), mimeType: 'image/jpeg' };
    const result = composeBoard([jpeg, solidPng([220, 30, 30])], SMALL);
    if (!result.ok) throw new Error(result.error);
    const [a] = boardGeometry(2, SMALL)?.cells ?? [];
    expectColor(decode(result.image.bytes).at(a.x + 32, a.y + 18), [30, 30, 220], 12);
  });

  it('reports what it cannot compose instead of throwing', () => {
    const png = solidPng([220, 30, 30]);
    const broken: FrameImage = { bytes: new Uint8Array([...png.bytes.subarray(0, 40), 1, 2, 3]), mimeType: 'image/png' };
    const webp: FrameImage = { bytes: webpVp8x(160, 90), mimeType: 'image/webp' };

    expect(composeBoard([png], SMALL)).toEqual({ ok: false, error: 'unsupported_count' });
    expect(composeBoard(Array.from({ length: 10 }, () => png), SMALL)).toEqual({ ok: false, error: 'unsupported_count' });
    expect(composeBoard([png, webp], SMALL)).toEqual({ ok: false, error: 'unsupported_format' });
    expect(composeBoard([png, broken], SMALL)).toEqual({ ok: false, error: 'decode_failed' });
  });
});
