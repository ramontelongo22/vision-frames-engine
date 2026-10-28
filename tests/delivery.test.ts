/**
 * Vision Frames v1 - Silent Delivery Boundary Tests (AC-14, RQ-12)
 */

import { toPublicOutcome } from '../src/delivery';
import { fail, harness, pass, png } from './helpers';

describe('toPublicOutcome', () => {
  it('exposes only the delivered image on success', async () => {
    const bytes = png(320, 180);
    const h = harness({ analyses: [pass()], generations: [{ bytes, mimeType: 'image/png' }] });
    const outcome = toPublicOutcome(await h.engine.execute({ identityDirection: 'calm' }));

    expect(outcome.status).toBe('delivered');
    expect(Object.keys(outcome)).toEqual(['status', 'image']);
    if (outcome.status === 'delivered') {
      expect(Object.keys(outcome.image).sort()).toEqual(['bytes', 'height', 'mimeType', 'width']);
      expect(Buffer.from(outcome.image.bytes).equals(bytes)).toBe(true);
    }
  });

  it.each([
    ['repeat violation stop', { analyses: [fail('isSeated')] }, { identityDirection: 'calm' }],
    ['likeness stop', { analyses: [fail('likenessIssue')] }, { identityDirection: 'calm' }],
    ['exhaustion', { analyses: [fail('isSeated'), fail('hasObjects'), fail('hasMultiplePeople')] }, { identityDirection: 'calm' }],
    ['filtered-out intent', { analyses: [pass()] }, { identityDirection: 'wealthy CEO' }],
    ['invalid input', { analyses: [pass()] }, { identityDirection: 3 }],
  ])('ends silently after %s with no reason, warning, or coaching', async (_label, options, input) => {
    const h = harness(options);
    const result = await h.engine.execute(input);
    const outcome = toPublicOutcome(result);

    expect(outcome).toEqual({ status: 'ended' });
    const serialized = JSON.stringify(outcome);
    expect(serialized).not.toContain(result.exitReason);
    expect(serialized).not.toMatch(/try again|violation|seated|likeness|filtered/i);
  });
});
