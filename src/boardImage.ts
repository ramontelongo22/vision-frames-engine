/**
 * Vision Frames v2 - Board image
 * Source: docs/DECISIONS.md V2-02 (owner-approved board spec, 2026-10-30)
 *
 * Lays the delivered frames out in a grid as one JPEG. The board image carries no
 * titles, captions or any other text, so nothing on it can break R1's language rules.
 * Each frame fills a 16:9 cell; a frame of another shape is scaled to cover the cell
 * and cropped evenly on the long side, never stretched. Rows with fewer frames are
 * centred. Frames keep the order they are given in.
 *
 * A board image needs at least 2 frames: when only one frame passes, that frame is
 * delivered alone. WebP frames are not decoded here; a board with one gets no board
 * image (the frames are still delivered).
 */

import { decode as decodeJpeg, encode as encodeJpeg } from 'jpeg-js';
import { PNG } from 'pngjs';
import { BOARD } from './config';
import { ImageMimeType } from './images';
import { Region, RgbaImage, coverRegion, resampleRgba } from './raster';

/** Frames per row for each number of delivered frames, top row first */
const ROWS: Readonly<Record<number, readonly number[]>> = {
  2: [2],
  3: [3],
  4: [2, 2],
  5: [3, 2],
  6: [3, 3],
  7: [4, 3],
  8: [4, 4],
  9: [3, 3, 3],
};

export interface BoardImageOptions {
  cellWidth: number;
  /** Cell width / height */
  cellAspect: number;
  gutter: number;
  margin: number;
  background: readonly [number, number, number];
  jpegQuality: number;
}

export interface BoardGeometry {
  width: number;
  height: number;
  cellWidth: number;
  cellHeight: number;
  /** One cell per frame, in frame order */
  cells: Region[];
}

export interface FrameImage {
  bytes: Uint8Array;
  mimeType: ImageMimeType;
}

export type BoardImageError = 'unsupported_count' | 'unsupported_format' | 'decode_failed' | 'encode_failed';

export type BoardImageResult =
  | { ok: true; image: { bytes: Uint8Array; mimeType: 'image/jpeg'; width: number; height: number } }
  | { ok: false; error: BoardImageError };

/** Grid geometry for `count` frames, or undefined when no board image is made for that count */
export function boardGeometry(count: number, options: BoardImageOptions = BOARD.image): BoardGeometry | undefined {
  const rows = ROWS[count];
  if (!rows) {
    return undefined;
  }
  const { cellWidth, gutter, margin } = options;
  const cellHeight = Math.round(cellWidth / options.cellAspect);
  const columns = Math.max(...rows);
  const width = 2 * margin + columns * cellWidth + (columns - 1) * gutter;
  const height = 2 * margin + rows.length * cellHeight + (rows.length - 1) * gutter;

  const cells: Region[] = [];
  rows.forEach((inRow, row) => {
    const rowWidth = inRow * cellWidth + (inRow - 1) * gutter;
    const left = Math.floor((width - rowWidth) / 2);
    const top = margin + row * (cellHeight + gutter);
    for (let column = 0; column < inRow; column++) {
      cells.push({ x: left + column * (cellWidth + gutter), y: top, width: cellWidth, height: cellHeight });
    }
  });
  return { width, height, cellWidth, cellHeight, cells };
}

type Decoded = { ok: true; image: RgbaImage } | { ok: false; error: 'unsupported_format' | 'decode_failed' };

function decodeFrame(frame: FrameImage): Decoded {
  try {
    const buffer = Buffer.from(frame.bytes.buffer, frame.bytes.byteOffset, frame.bytes.byteLength);
    switch (frame.mimeType) {
      case 'image/png': {
        const png = PNG.sync.read(buffer);
        return { ok: true, image: { width: png.width, height: png.height, data: png.data } };
      }
      case 'image/jpeg': {
        const jpeg = decodeJpeg(buffer, { useTArray: true, formatAsRGBA: true });
        return { ok: true, image: { width: jpeg.width, height: jpeg.height, data: jpeg.data } };
      }
      default:
        return { ok: false, error: 'unsupported_format' };
    }
  } catch {
    return { ok: false, error: 'decode_failed' };
  }
}

/**
 * Compose the frames into one board JPEG. Never throws.
 */
export function composeBoard(frames: readonly FrameImage[], options: BoardImageOptions = BOARD.image): BoardImageResult {
  const geometry = boardGeometry(frames.length, options);
  if (!geometry) {
    return { ok: false, error: 'unsupported_count' };
  }

  const { width, height, cells } = geometry;
  const [br, bg, bb] = options.background;
  const canvas = new Uint8Array(width * height * 4);
  for (let o = 0; o < canvas.length; o += 4) {
    canvas[o] = br;
    canvas[o + 1] = bg;
    canvas[o + 2] = bb;
    canvas[o + 3] = 255;
  }

  for (let f = 0; f < frames.length; f++) {
    const decoded = decodeFrame(frames[f]);
    if (!decoded.ok) {
      return { ok: false, error: decoded.error };
    }
    const cell = cells[f];
    const source = decoded.image;
    const region = coverRegion(source.width, source.height, cell.width / cell.height);
    const scaled = resampleRgba(source, region, cell.width, cell.height);
    const pixels = scaled.data;
    for (let y = 0; y < cell.height; y++) {
      for (let x = 0; x < cell.width; x++) {
        const i = (y * cell.width + x) * 4;
        const o = ((cell.y + y) * width + cell.x + x) * 4;
        // Any transparency is flattened onto the board background
        const alpha = pixels[i + 3] / 255;
        canvas[o] = Math.round(pixels[i] * alpha + br * (1 - alpha));
        canvas[o + 1] = Math.round(pixels[i + 1] * alpha + bg * (1 - alpha));
        canvas[o + 2] = Math.round(pixels[i + 2] * alpha + bb * (1 - alpha));
      }
    }
  }

  try {
    const jpeg = encodeJpeg({ width, height, data: Buffer.from(canvas.buffer) }, options.jpegQuality);
    return { ok: true, image: { bytes: new Uint8Array(jpeg.data), mimeType: 'image/jpeg', width, height } };
  } catch {
    return { ok: false, error: 'encode_failed' };
  }
}
