/**
 * Vision Frames - reference photo re-encoding tests (P-09)
 *
 * Every JPEG, PNG or WebP reference is re-encoded before it can reach a provider: upright,
 * metadata-free, at most 2048 px on the longest side. Fixtures are made with sharp here;
 * none is a real phone photo.
 */

import { randomBytes } from 'crypto';
import sharp from 'sharp';
import { LIMITS } from '../src/config';
import { validateImageBytes } from '../src/images';
import { reencodeReferences } from '../src/intake';
import { reencodePhoto } from '../src/photo';
import { expectCleanTermination, harness, jpeg, pass, png } from './helpers';

/** A JPEG that stores 300 x 200 pixels, tagged to display rotated 90 degrees, with GPS location */
async function phoneJpeg(): Promise<Buffer> {
  return sharp({ create: { width: 300, height: 200, channels: 3, background: { r: 120, g: 90, b: 60 } } })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .withExifMerge({
      IFD0: { Make: 'PhoneMaker', Model: 'Phone 1' },
      IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '40/1 26/1 46/1', GPSLongitudeRef: 'W', GPSLongitude: '79/1 58/1 56/1' },
    })
    .toBuffer();
}

/** True when an EXIF block holds a pointer to a GPS directory (tag 0x8825, either byte order) */
function hasGpsDirectory(exif: Buffer | undefined): boolean {
  return !!exif && (exif.includes(Buffer.from([0x88, 0x25])) || exif.includes(Buffer.from([0x25, 0x88])));
}

/** Random noise compresses badly, so this JPEG is well over the 4 MB reference limit */
async function largeNoiseJpeg(width = 3000, height = 3000): Promise<Buffer> {
  return sharp(randomBytes(width * height * 3), { raw: { width, height, channels: 3 } }).jpeg({ quality: 100 }).toBuffer();
}

describe('reencodePhoto', () => {
  it('applies the EXIF orientation and drops every piece of metadata', async () => {
    const input = await phoneJpeg();
    const before = await sharp(input).metadata();
    expect(before.orientation).toBe(6);
    expect(hasGpsDirectory(before.exif)).toBe(true);
    expect(input.includes('PhoneMaker')).toBe(true);

    const result = await reencodePhoto(input);
    if (!result.ok) throw new Error(result.error);

    // Stored 300 wide; orientation 6 displays it 200 wide and 300 tall
    expect({ width: result.width, height: result.height }).toEqual({ width: 200, height: 300 });
    const after = await sharp(Buffer.from(result.bytes)).metadata();
    expect(after.format).toBe('jpeg');
    expect(after.exif).toBeUndefined();
    expect(after.orientation).toBeUndefined();
    expect(after.xmp).toBeUndefined();
    expect(after.icc).toBeUndefined();
    expect(Buffer.from(result.bytes).includes('PhoneMaker')).toBe(false);
  });

  it('shrinks a photo over the reference size limit instead of rejecting it', async () => {
    const input = await largeNoiseJpeg();
    expect(input.length).toBeGreaterThan(LIMITS.reference.maxBytes);

    const result = await reencodePhoto(input);
    if (!result.ok) throw new Error(result.error);

    expect({ width: result.width, height: result.height }).toEqual({ width: 2048, height: 2048 });
    expect(validateImageBytes(result.bytes, 'image/jpeg', LIMITS.reference).ok).toBe(true);
  });

  it('never enlarges a small photo', async () => {
    const result = await reencodePhoto(png(200, 300));
    expect(result).toMatchObject({ ok: true, width: 200, height: 300 });
  });

  it('flattens transparency onto white', async () => {
    const transparent = await sharp({ create: { width: 80, height: 80, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .png()
      .toBuffer();
    const result = await reencodePhoto(transparent);
    if (!result.ok) throw new Error(result.error);

    const { data } = await sharp(Buffer.from(result.bytes)).raw().toBuffer({ resolveWithObject: true });
    expect(Math.min(...data.subarray(0, 300))).toBeGreaterThan(245);
  });

  it('re-encodes WebP as JPEG', async () => {
    const webp = await sharp({ create: { width: 120, height: 90, channels: 3, background: { r: 1, g: 2, b: 3 } } }).webp().toBuffer();
    const result = await reencodePhoto(webp);
    if (!result.ok) throw new Error(result.error);
    expect(validateImageBytes(result.bytes, 'image/jpeg', LIMITS.reference)).toMatchObject({ ok: true, image: { mimeType: 'image/jpeg' } });
  });

  it('refuses files over the input byte limit without decoding', async () => {
    const result = await reencodePhoto(png(200, 300), { ...LIMITS.referenceUpload, maxInputBytes: 100 });
    expect(result).toEqual({ ok: false, error: 'too_large' });
  });

  it('refuses images over the pixel limit', async () => {
    const result = await reencodePhoto(png(1000, 1000), { ...LIMITS.referenceUpload, maxPixels: 500_000 });
    expect(result).toEqual({ ok: false, error: 'too_large' });
  });

  it('reports a decode failure for a damaged file instead of throwing', async () => {
    // Structurally valid headers with no image data
    const result = await reencodePhoto(jpeg(640, 480));
    expect(result).toEqual({ ok: false, error: 'decode_failed' });
  });
});

describe('reencodeReferences', () => {
  it('rejects a declared MIME type that contradicts the bytes before decoding', async () => {
    const result = await reencodeReferences([{ bytes: png(), mimeType: 'image/jpeg' }]);
    expect(result).toEqual({ ok: false, reason: 'reference 1 failed validation: mime_mismatch' });
  });

  it('rejects uploads over the upload byte limit', async () => {
    const big = Buffer.concat([png(), Buffer.alloc(LIMITS.referenceUpload.maxInputBytes)]);
    const result = await reencodeReferences([{ bytes: big }]);
    expect(result).toEqual({ ok: false, reason: 'reference 1 failed validation: too_large' });
  });

  it('passes through entries that reference validation rejects anyway', async () => {
    const raw = [{ name: 'me.jpg' }, null, { bytes: 'not bytes' }];
    const result = await reencodeReferences(raw);
    expect(result).toEqual({ ok: true, references: raw, convertedCount: 0 });
  });
});

describe('engine with phone photos', () => {
  const input = { identityDirection: 'calm and grounded' };

  it('sends providers an upright, metadata-free JPEG and accepts photos over 4 MB', async () => {
    const h = harness({ analyses: [pass()], references: [{ bytes: await phoneJpeg() }, { bytes: await largeNoiseJpeg() }] });
    const result = await h.engine.execute(input);

    expect(result.exitReason).toBe('success');
    expect(result.events).toContainEqual({ type: 'references_converted', count: 2 });
    for (const call of [h.generateCalls[0], h.analyzeCalls[0]]) {
      expect(call.references[0]).toMatchObject({ mimeType: 'image/jpeg', width: 200, height: 300 });
      expect(call.references[1]).toMatchObject({ mimeType: 'image/jpeg', width: 2048, height: 2048 });
      for (const reference of call.references) {
        expect((await sharp(Buffer.from(reference.bytes)).metadata()).exif).toBeUndefined();
      }
    }
    expectCleanTermination(result, h);
  });

  it('ends before any model call when a photo cannot be decoded', async () => {
    const h = harness({ analyses: [pass()], references: [{ bytes: jpeg(640, 480) }] });
    const result = await h.engine.execute(input);

    expect(result.exitReason).toBe('invalid_references');
    expect(result.events).toContainEqual({ type: 'references_rejected', reason: 'reference 1 failed validation: decode_failed' });
    expect(h.ledger).toEqual([]);
    expectCleanTermination(result, h);
  });
});
