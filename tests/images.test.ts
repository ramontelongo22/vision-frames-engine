/**
 * Vision Frames v1 - Image Contract Tests (AC-02, AC-15)
 */

import { LIMITS } from '../src/config';
import { validateImageBytes } from '../src/images';
import { jpeg, png, webpVp8x } from './helpers';

const limits = LIMITS.reference;

describe('validateImageBytes', () => {
  it('accepts a PNG and reads its dimensions from the bytes', () => {
    const result = validateImageBytes(png(320, 240), 'image/png', limits);
    expect(result).toEqual({ ok: true, image: expect.objectContaining({ mimeType: 'image/png', width: 320, height: 240 }) });
  });

  it('accepts a JPEG and reads its frame dimensions', () => {
    const result = validateImageBytes(jpeg(1024, 768), 'image/jpeg', limits);
    expect(result).toEqual({ ok: true, image: expect.objectContaining({ mimeType: 'image/jpeg', width: 1024, height: 768 }) });
  });

  it('accepts a WebP and reads its canvas dimensions', () => {
    const result = validateImageBytes(webpVp8x(800, 600), 'image/webp', limits);
    expect(result).toEqual({ ok: true, image: expect.objectContaining({ mimeType: 'image/webp', width: 800, height: 600 }) });
  });

  it('sniffs the format when no MIME type is declared instead of assuming PNG', () => {
    const result = validateImageBytes(jpeg(500, 500), undefined, limits);
    expect(result.ok && result.image.mimeType).toBe('image/jpeg');
  });

  it('treats image/jpg as image/jpeg', () => {
    expect(validateImageBytes(jpeg(500, 500), 'image/jpg', limits).ok).toBe(true);
  });

  it.each([
    ['a string', 'iVBORw0KGgo=', undefined, 'not_binary'],
    ['empty bytes', Buffer.alloc(0), undefined, 'empty'],
    ['text bytes', Buffer.from('hello world, not an image'), undefined, 'unsupported_format'],
    ['GIF bytes', Buffer.from('GIF89a........'), undefined, 'unsupported_format'],
    ['a declared MIME that contradicts the bytes', png(), 'image/jpeg', 'mime_mismatch'],
    ['a non-image MIME', png(), 'application/octet-stream', 'mime_mismatch'],
    ['a truncated PNG header', png().subarray(0, 12), undefined, 'unreadable_dimensions'],
    ['a JPEG without a frame header', Buffer.from([0xff, 0xd8, 0xff, 0xd9]), undefined, 'unreadable_dimensions'],
    ['an image below the minimum size', png(10, 10), undefined, 'dimensions_out_of_range'],
  ])('rejects %s', (_label, bytes, mime, error) => {
    expect(validateImageBytes(bytes, mime, limits)).toEqual({ ok: false, error });
  });

  it('rejects oversized payloads', () => {
    const big = Buffer.concat([png(), Buffer.alloc(limits.maxBytes)]);
    expect(validateImageBytes(big, 'image/png', limits)).toEqual({ ok: false, error: 'too_large' });
  });
});
