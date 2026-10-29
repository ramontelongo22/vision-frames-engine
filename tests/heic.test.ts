/**
 * Vision Frames v1 - HEIC reference conversion tests (O-05)
 *
 * Fixtures in tests/fixtures were encoded with libheif's x265 encoder (pillow-heif):
 * - reference-160x120.heic: left half red (200, 40, 40), right half blue (40, 40, 200)
 * - reference-2600x200.heic: flat gray (128, 128, 128), wide so the downscale path stays fast
 * They are not iPhone files: iPhone photos use tiled grid images and rotation boxes,
 * which libheif handles but these fixtures do not exercise.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { decode as decodeJpeg } from 'jpeg-js';
import { LIMITS } from '../src/config';
import { convertHeicToJpeg, downscaleRgba, isHeic } from '../src/heic';
import { validateImageBytes } from '../src/images';
import { convertHeicReferences } from '../src/intake';
import { expectCleanTermination, harness, jpeg, pass, png, references } from './helpers';

afterEach(() => jest.restoreAllMocks());

const fixture = (name: string): Buffer => readFileSync(join(__dirname, 'fixtures', name));
const small = fixture('reference-160x120.heic');
const large = fixture('reference-2600x200.heic');

function ftyp(major: string, compatible: string[]): Buffer {
  const size = 16 + compatible.length * 4;
  const box = Buffer.alloc(size + 8);
  box.writeUInt32BE(size, 0);
  box.write('ftyp', 4, 'ascii');
  box.write(major, 8, 'ascii');
  compatible.forEach((brand, i) => box.write(brand, 16 + i * 4, 'ascii'));
  return box;
}

describe('isHeic', () => {
  it('recognises HEVC-coded HEIF files', () => {
    expect(isHeic(small)).toBe(true);
    expect(isHeic(large)).toBe(true);
    expect(isHeic(ftyp('mif1', ['mif1', 'heic']))).toBe(true);
    expect(isHeic(ftyp('heix', []))).toBe(true);
  });

  it('rejects AVIF, other formats, and short input', () => {
    expect(isHeic(ftyp('avif', ['mif1', 'miaf']))).toBe(false);
    expect(isHeic(ftyp('mif1', ['avif']))).toBe(false);
    expect(isHeic(png())).toBe(false);
    expect(isHeic(jpeg(100, 100))).toBe(false);
    expect(isHeic(new Uint8Array(8))).toBe(false);
  });
});

describe('convertHeicToJpeg', () => {
  it('converts a HEIC image to a JPEG that passes the reference contract', async () => {
    const result = await convertHeicToJpeg(small);
    if (!result.ok) throw new Error(result.error);

    expect(result.width).toBe(160);
    expect(result.height).toBe(120);
    const validation = validateImageBytes(result.bytes, 'image/jpeg', LIMITS.reference);
    expect(validation.ok).toBe(true);

    // Decoded pixels keep the fixture's layout: red on the left, blue on the right
    const pixels = decodeJpeg(Buffer.from(result.bytes), { useTArray: true });
    const at = (x: number, y: number) => Array.from(pixels.data.subarray((y * 160 + x) * 4, (y * 160 + x) * 4 + 3));
    const [lr, lg, lb] = at(20, 60);
    const [rr, rg, rb] = at(140, 60);
    expect(lr).toBeGreaterThan(150);
    expect(lb).toBeLessThan(90);
    expect(rb).toBeGreaterThan(150);
    expect(rr).toBeLessThan(90);
    expect(lg).toBeLessThan(90);
    expect(rg).toBeLessThan(90);
  });

  it('downscales large photos so the longest side is at most 2048 px', async () => {
    const result = await convertHeicToJpeg(large);
    if (!result.ok) throw new Error(result.error);

    expect(result.width).toBe(2048);
    expect(result.height).toBe(158);
    expect(validateImageBytes(result.bytes, 'image/jpeg', LIMITS.reference).ok).toBe(true);
  });

  it('refuses files over the input byte limit without decoding', async () => {
    const result = await convertHeicToJpeg(small, { ...LIMITS.heicReference, maxInputBytes: 100 });
    expect(result).toEqual({ ok: false, error: 'too_large' });
  });

  it('refuses images over the pixel limit', async () => {
    const result = await convertHeicToJpeg(large, { ...LIMITS.heicReference, maxPixels: 500_000 });
    expect(result).toEqual({ ok: false, error: 'too_large' });
  });

  it('reports a decode failure for a damaged file instead of throwing', async () => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined); // libheif logs parse errors
    const damaged = Buffer.concat([small.subarray(0, 64), Buffer.alloc(64)]);
    expect(isHeic(damaged)).toBe(true);
    const result = await convertHeicToJpeg(damaged);
    expect(result).toEqual({ ok: false, error: 'decode_failed' });
  });
});

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

describe('convertHeicReferences', () => {
  it('converts HEIC entries and leaves other images untouched', async () => {
    const other = references(1)[0];
    const result = await convertHeicReferences([{ bytes: small }, other]);
    if (!result.ok) throw new Error(result.reason);

    expect(result.convertedCount).toBe(1);
    const [converted, untouched] = result.references as Array<{ bytes: Uint8Array; mimeType: string }>;
    expect(converted.mimeType).toBe('image/jpeg');
    expect(untouched).toBe(other);
  });

  it.each(['image/heic', 'image/HEIF', 'image/heic; charset=binary'])('accepts a declared %s type', async (mimeType) => {
    const result = await convertHeicReferences([{ bytes: small, mimeType }]);
    expect(result.ok).toBe(true);
  });

  it('rejects HEIC bytes declared as another type', async () => {
    const result = await convertHeicReferences([{ bytes: small, mimeType: 'image/png' }]);
    expect(result).toEqual({ ok: false, reason: 'reference 1 failed validation: mime_mismatch' });
  });

  it('passes through input that reference validation rejects anyway', async () => {
    const tooMany = Array.from({ length: LIMITS.maxReferenceImages + 1 }, () => ({ bytes: small }));
    for (const raw of ['not an array', tooMany]) {
      const result = await convertHeicReferences(raw);
      expect(result).toEqual({ ok: true, references: raw, convertedCount: 0 });
    }
  });
});

describe('engine with HEIC references', () => {
  const input = { identityDirection: 'calm and grounded' };

  it('sends converted JPEG references to generation and analysis', async () => {
    const h = harness({ analyses: [pass()], references: [{ bytes: small }, references(1)[0]] });
    const result = await h.engine.execute(input);

    expect(result.exitReason).toBe('success');
    expect(result.events).toContainEqual({ type: 'references_converted', count: 1 });
    for (const call of [h.generateCalls[0], h.analyzeCalls[0]]) {
      expect(call.references[0]).toMatchObject({ id: 'ref-1', mimeType: 'image/jpeg', width: 160, height: 120 });
      expect(call.references[1]).toMatchObject({ id: 'ref-2', mimeType: 'image/png' });
    }
    expectCleanTermination(result, h);
  });

  it('ends before any model call when a HEIC reference cannot be decoded', async () => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined); // libheif logs parse errors
    const damaged = Buffer.concat([small.subarray(0, 64), Buffer.alloc(64)]);
    const h = harness({ analyses: [pass()], references: [{ bytes: damaged }] });
    const result = await h.engine.execute(input);

    expect(result.exitReason).toBe('invalid_references');
    expect(result.events).toContainEqual({
      type: 'references_rejected', reason: 'reference 1 failed validation: heic_decode_failed',
    });
    expect(h.ledger).toEqual([]);
    expectCleanTermination(result, h);
  });
});
