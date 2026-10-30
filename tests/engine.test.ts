/**
 * Vision Frames v1 - Engine Tests
 *
 * Counters, hard stops, terminal propagation, refinement base selection, and
 * fail-closed handling, each tied to the handoff acceptance criteria (AC-xx) and the
 * audit probes that reproduced the baseline defects (F03-F07, F09, F11).
 */

import { ProviderError } from '../src/errors';
import { buildCanonicalPrompt, CANONICAL_PROMPT_V1 } from '../src/promptBuilder';
import { normalize } from '../src/normalize';
import { CONFIG } from '../src/config';
import { SemanticNormalizer } from '../src/semanticNormalizer';
import { expectCleanTermination, fail, harness, pass, png, references } from './helpers';

const input = { identityDirection: 'calm and grounded' };

describe('VisionFramesEngine', () => {
  describe('AC-07 generation cap (max 3 total generations)', () => {
    it('makes exactly three generation calls for three distinct failures', async () => {
      const h = harness({ analyses: [fail('isSeated'), fail('hasObjects'), fail('hasMultiplePeople')] });
      const result = await h.engine.execute(input);

      expect(result.exitReason).toBe('generations_exhausted');
      expect(result.success).toBe(false);
      expect(h.generateCalls).toHaveLength(CONFIG.maxGenerations);
      expect(h.ledger).toEqual(['generate', 'analyze', 'generate', 'analyze', 'generate', 'analyze']);
      expect(result.violations).toEqual([['seated'], ['objects_or_props'], ['multiple_people']]);
      expectCleanTermination(result, h);
    });

    it('never exceeds three generations even when no call yields an image', async () => {
      const h = harness({
        analyses: [pass()],
        generations: [
          new ProviderError('no_image', 'text only'),
          new ProviderError('refusal', 'blocked'),
          new ProviderError('timeout', 'slow'),
        ],
      });
      const result = await h.engine.execute(input);

      expect(result.exitReason).toBe('generations_exhausted');
      expect(h.generateCalls).toHaveLength(3);
      expect(h.analyzeCalls).toHaveLength(0);
      expectCleanTermination(result, h);
    });
  });

  describe('AC-10 same violation repeats (second occurrence anywhere in the run)', () => {
    it('stops on the second seated result instead of making a third generation', async () => {
      const h = harness({ analyses: [fail('isSeated')] });
      const result = await h.engine.execute(input);

      expect(result.exitReason).toBe('repeat_violations');
      expect(h.generateCalls).toHaveLength(2);
      expect(h.analyzeCalls).toHaveLength(2);
      expectCleanTermination(result, h);
    });

    it('stops on a repeated violation inside mixed violation sets', async () => {
      const h = harness({
        analyses: [fail('isSeated', 'hasObjects'), fail('hasObjects', 'hasMultiplePeople'), pass()],
      });
      const result = await h.engine.execute(input);

      expect(result.exitReason).toBe('repeat_violations');
      expect(h.generateCalls).toHaveLength(2);
      expectCleanTermination(result, h);
    });

    it('counts non-adjacent recurrence across generation and refinement', async () => {
      // generation-1 seated, generation-2 passes, its refinement comes back seated:
      // the stop prevents the second refinement and the passing base is delivered (V2-01)
      const h = harness({ analyses: [fail('isSeated'), pass('lighting'), fail('isSeated'), pass()] });
      const result = await h.engine.execute(input);

      expect(h.ledger).toEqual(['generate', 'analyze', 'generate', 'analyze', 'refine', 'analyze']);
      expect(result.events).toContainEqual({
        type: 'refinement_abandoned', baseId: 'generation-2', cause: 'repeat_violations',
      });
      expect(result.finalImage?.id).toBe('generation-2');
      expectCleanTermination(result, h);
    });

    it('does not let an intervening pass clear violation history', async () => {
      const h = harness({
        analyses: [fail('hasObjects'), pass('lighting'), fail('hasMultiplePeople'), fail('hasObjects'), pass()],
      });
      const result = await h.engine.execute(input);

      expect(result.events).toContainEqual({
        type: 'refinement_abandoned', baseId: 'generation-2', cause: 'repeat_violations',
      });
      expect(h.generateCalls).toHaveLength(2);
      expect(h.refineCalls).toHaveLength(2);
      expectCleanTermination(result, h);
    });
  });

  describe('AC-09 likeness fails twice', () => {
    it('stops after the second likeness failure with no third generation (audit probe)', async () => {
      // Baseline made three generations here and discarded the passing third analysis
      const h = harness({ analyses: [fail('likenessIssue'), fail('likenessIssue'), pass()] });
      const result = await h.engine.execute(input);

      expect(result.exitReason).toBe('likeness_failed_twice');
      expect(h.ledger).toEqual(['generate', 'analyze', 'generate', 'analyze']);
      expectCleanTermination(result, h);
    });

    it('stops attempts when the second likeness failure comes from a refinement', async () => {
      const h = harness({ analyses: [fail('likenessIssue'), pass('lighting'), fail('likenessIssue'), pass()] });
      const result = await h.engine.execute(input);

      expect(h.ledger).toEqual(['generate', 'analyze', 'generate', 'analyze', 'refine', 'analyze']);
      expect(result.events).toContainEqual({
        type: 'refinement_abandoned', baseId: 'generation-2', cause: 'likeness_failed_twice',
      });
      expect(result.finalImage?.id).toBe('generation-2');
      expectCleanTermination(result, h);
    });

    it('stops after two failed refinements on likeness without generating again', async () => {
      const h = harness({ analyses: [pass('lighting'), fail('likenessIssue'), fail('likenessIssue'), pass()] });
      const result = await h.engine.execute(input);

      expect(h.ledger).toEqual(['generate', 'analyze', 'refine', 'analyze', 'refine', 'analyze']);
      expect(result.events).toContainEqual({
        type: 'refinement_abandoned', baseId: 'generation-1', cause: 'likeness_failed_twice',
      });
      expect(result.finalImage?.id).toBe('generation-1');
      expectCleanTermination(result, h);
    });

    it('counts likeness failures that arrive alongside other violations', async () => {
      const h = harness({ analyses: [fail('likenessIssue', 'isSeated'), fail('likenessIssue', 'hasObjects')] });
      const result = await h.engine.execute(input);

      expect(result.exitReason).toBe('likeness_failed_twice');
      expect(h.generateCalls).toHaveLength(2);
      expectCleanTermination(result, h);
    });
  });

  describe('AC-08 refinement cap is one budget for the whole run', () => {
    it('makes at most two refinement calls, then delivers the passing base (audit probe)', async () => {
      // Baseline made six refinement calls here and reported two
      const h = harness({ analyses: [pass('lighting'), fail('hasObjects'), fail('hasMultiplePeople')] });
      const result = await h.engine.execute(input);

      expect(h.refineCalls).toHaveLength(2);
      expect(result.refinementAttempts).toBe(2);
      // O-03: the QA-passing generation is delivered instead of generating again
      expect(result.exitReason).toBe('success');
      expect(result.finalImage?.id).toBe('generation-1');
      expect(h.generateCalls).toHaveLength(1);
      expect(h.ledger).toEqual(['generate', 'analyze', 'refine', 'analyze', 'refine', 'analyze']);
      expect(result.events).toContainEqual({
        type: 'refinement_abandoned', baseId: 'generation-1', cause: 'attempts_failed',
      });
      expectCleanTermination(result, h);
    });

    it('counts a refinement call that fails at the provider', async () => {
      const h = harness({
        analyses: [pass('lighting'), pass()],
        refinements: [new ProviderError('timeout', 'slow')],
      });
      const result = await h.engine.execute(input);

      expect(result.exitReason).toBe('success');
      expect(result.finalImage?.id).toBe('refinement-2');
      expect(result.refinementAttempts).toBe(2);
      expectCleanTermination(result, h);
    });

    it('delivers the passing base when both refinement calls fail transiently', async () => {
      const h = harness({
        analyses: [pass('environment_tone')],
        refinements: [new ProviderError('timeout', 'slow'), new ProviderError('no_image', 'text only')],
      });
      const result = await h.engine.execute(input);

      expect(result.exitReason).toBe('success');
      expect(result.finalImage?.id).toBe('generation-1');
      expect(result.refinementAttempts).toBe(2);
      expect(h.ledger).toEqual(['generate', 'analyze', 'refine', 'refine']);
      expectCleanTermination(result, h);
    });
  });

  describe('O-03 a failed refinement delivers the QA-passing base', () => {
    it.each(['auth', 'quota', 'bad_request'] as const)(
      'delivers the base when a refinement call has a fatal %s failure',
      async (kind) => {
        const h = harness({ analyses: [pass('lighting')], refinements: [new ProviderError(kind, 'x')] });
        const result = await h.engine.execute(input);

        expect(result.exitReason).toBe('success');
        expect(result.finalImage?.id).toBe('generation-1');
        expect(h.ledger).toEqual(['generate', 'analyze', 'refine']);
        expect(result.events).toContainEqual({ type: 'refinement_abandoned', baseId: 'generation-1', cause: kind });
        expectCleanTermination(result, h);
      }
    );

    it('delivers the base when the analyzer fails fatally on the refined image', async () => {
      const h = harness({ analyses: [pass('lighting'), new ProviderError('auth', 'bad key')] });
      const result = await h.engine.execute(input);

      expect(result.exitReason).toBe('success');
      expect(result.finalImage?.id).toBe('generation-1');
      expect(h.ledger).toEqual(['generate', 'analyze', 'refine', 'analyze']);
      expectCleanTermination(result, h);
    });

    it('delivers the base when a refined image has invalid analysis twice', async () => {
      const h = harness({ analyses: [pass('minor_framing'), { findings: {} }, 'not json'] });
      const result = await h.engine.execute(input);

      expect(result.exitReason).toBe('success');
      expect(result.finalImage?.id).toBe('generation-1');
      expect(h.refineCalls).toHaveLength(2);
      expectCleanTermination(result, h);
    });

    it('ends with nothing when a hard stop comes from generations', async () => {
      // Only a refinement's base is delivered on a hard stop; generations never are
      const h = harness({ analyses: [fail('likenessIssue'), fail('likenessIssue')] });
      const result = await h.engine.execute(input);

      expect(result.exitReason).toBe('likeness_failed_twice');
      expect(result.success).toBe(false);
      expectCleanTermination(result, h);
    });

    it('still ends with nothing when cancelled during a refinement', async () => {
      const controller = new AbortController();
      const h = harness({
        analyses: [pass('lighting')],
        refinements: [() => {
          controller.abort();
          return { bytes: png(), mimeType: 'image/png' };
        }],
      });
      const result = await h.engine.execute(input, { signal: controller.signal });

      expect(result.exitReason).toBe('cancelled');
      expect(result.success).toBe(false);
      expect(h.ledger).toEqual(['generate', 'analyze', 'refine']);
      expectCleanTermination(result, h);
    });
  });

  describe('AC-12 terminal state propagates', () => {
    it('ends the whole run when a hard stop happens inside refinement', async () => {
      // Baseline returned from the refinement loop and kept generating
      const h = harness({ analyses: [fail('hasObjects'), pass('lighting'), fail('hasObjects'), pass()] });
      const result = await h.engine.execute(input);

      // No second refinement and no third generation. V2-01: the QA-passing base is
      // delivered rather than nothing
      expect(h.ledger).toEqual(['generate', 'analyze', 'generate', 'analyze', 'refine', 'analyze']);
      expect(result.finalImage?.id).toBe('generation-2');
      const terminatedAt = result.events.findIndex((e) => e.type === 'terminated');
      const workAfter = result.events.slice(terminatedAt + 1);
      expect(workAfter).toEqual([]);
      expectCleanTermination(result, h);
    });
  });

  describe('AC-13 refinement only when eligible', () => {
    it('delivers a passing generation directly when no refinement is eligible', async () => {
      // Baseline always spent a refinement, even on a clean image
      const h = harness({ analyses: [pass(null)] });
      const result = await h.engine.execute(input);

      expect(result.exitReason).toBe('success');
      expect(result.finalImage?.id).toBe('generation-1');
      expect(result.finalImage?.origin).toBe('generation');
      expect(h.refineCalls).toHaveLength(0);
      expectCleanTermination(result, h);
    });

    it('applies the one eligible refinement and delivers the refined image when it passes', async () => {
      const h = harness({ analyses: [pass('environment_tone'), pass('lighting')] });
      const result = await h.engine.execute(input);

      expect(result.exitReason).toBe('success');
      expect(result.finalImage?.id).toBe('refinement-1');
      expect(result.finalImage?.baseId).toBe('generation-1');
      expect(h.refineCalls).toHaveLength(1);
      expect(h.refineCalls[0].refinement).toBe('environment_tone');
      expectCleanTermination(result, h);
    });
  });

  describe('AC-06 refinement edits only the clean base', () => {
    it('never uses a failed refinement as the next base image', async () => {
      const generated = { bytes: png(300, 200, [1, 2, 3]), mimeType: 'image/png' };
      const h = harness({
        analyses: [pass('minor_framing'), fail('isOverStylized'), pass()],
        generations: [generated],
      });
      const result = await h.engine.execute(input);

      expect(result.exitReason).toBe('success');
      expect(h.refineCalls).toHaveLength(2);
      for (const call of h.refineCalls) {
        expect(call.baseImage.id).toBe('generation-1');
        expect(Buffer.from(call.baseImage.bytes).equals(generated.bytes)).toBe(true);
        expect(call.refinement).toBe('minor_framing');
        expect(call.prompt).toContain(CANONICAL_PROMPT_V1);
      }
      expectCleanTermination(result, h);
    });
  });

  describe('AC-04 malformed analysis never passes', () => {
    const malformed: Array<[string, unknown]> = [
      ['empty object', {}],
      ['null', null],
      ['undefined', undefined],
      ['string', 'pass'],
      ['array', []],
      ['bare findings without report wrapper', { isSeated: false }],
      ['missing refinement key', { findings: pass().findings }],
      ['missing finding field', { findings: { ...pass().findings, isSeated: undefined }, refinement: null }],
      ['string boolean', { findings: { ...pass().findings, likenessIssue: 'false' }, refinement: null }],
      ['numeric boolean', { findings: { ...pass().findings, hasObjects: 0 }, refinement: null }],
      ['extra finding field', { findings: { ...pass().findings, passed: true }, refinement: null }],
      ['unknown refinement', { findings: pass().findings, refinement: 'face' }],
      ['extra report field', { ...pass(), passed: true }],
    ];

    it.each(malformed)('rejects %s and never delivers', async (_label, report) => {
      const h = harness({ analyses: [report] });
      const result = await h.engine.execute(input);

      expect(result.success).toBe(false);
      expect(result.exitReason).toBe('generations_exhausted');
      expect(h.generateCalls).toHaveLength(3);
      expect(h.refineCalls).toHaveLength(0);
      expect(result.events.filter((e) => e.type === 'analysis_invalid')).toHaveLength(3);
      expectCleanTermination(result, h);
    });

    it('discards a candidate with invalid analysis and continues to the next generation', async () => {
      const h = harness({ analyses: [{}, pass()] });
      const result = await h.engine.execute(input);

      expect(result.exitReason).toBe('success');
      expect(result.finalImage?.id).toBe('generation-2');
      expectCleanTermination(result, h);
    });
  });

  describe('AC-05 references go out with every request', () => {
    it('sends the same re-encoded reference photos, in order, to generation, refinement and analysis', async () => {
      const refs = references(3);
      const h = harness({ analyses: [pass('lighting'), pass()], references: refs });
      await h.engine.execute(input);

      const calls = [h.generateCalls[0], h.refineCalls[0], ...h.analyzeCalls];
      const sent = h.generateCalls[0].references;
      for (const call of calls) {
        expect(call.references).toHaveLength(3);
        call.references.forEach((reference, i) => {
          // P-09: every reference is re-encoded as JPEG; the same bytes go to every call
          expect(reference.bytes).toBe(sent[i].bytes);
          expect(Buffer.from(reference.bytes).equals(refs[i].bytes)).toBe(false);
          expect(reference.mimeType).toBe('image/jpeg');
          expect(reference.width).toBe(200 + i);
          expect(reference.height).toBe(300);
        });
      }
      expect(h.analyzeCalls[0].candidate.id).toBe('generation-1');
      expect(h.analyzeCalls[1].candidate.id).toBe('refinement-1');
    });

    const badReferences: Array<[string, unknown]> = [
      ['no references', []],
      ['not an array', 'photo.jpg'],
      ['file names only', [{ name: 'me.jpg' }]],
      ['non-image bytes', [{ bytes: Buffer.from('not an image'), mimeType: 'image/png' }]],
      ['declared MIME that contradicts the bytes', [{ bytes: png(), mimeType: 'image/jpeg' }]],
      ['too many references', references(5)],
      ['too small to judge likeness', [{ bytes: png(16, 16), mimeType: 'image/png' }]],
    ];

    it.each(badReferences)('ends before any model call with %s', async (_label, refs) => {
      const h = harness({ analyses: [pass()], references: refs as unknown[] });
      const result = await h.engine.execute(input);

      expect(result.exitReason).toBe('invalid_references');
      expect(h.ledger).toEqual([]);
      expectCleanTermination(result, h);
    });
  });

  describe('AC-15 provider and payload failures', () => {
    it('rejects a non-image payload as a counted, discarded attempt', async () => {
      const h = harness({
        analyses: [pass()],
        generations: [{ bytes: Buffer.from('<html>'), mimeType: 'image/png' }],
      });
      const result = await h.engine.execute(input);

      expect(result.events).toContainEqual({
        type: 'candidate_rejected', operation: 'generation', attempt: 1, reason: 'unsupported_format',
      });
      expect(result.finalImage?.id).toBe('generation-2');
      expect(h.analyzeCalls).toHaveLength(1);
      expectCleanTermination(result, h);
    });

    it('rejects image bytes labeled with a non-image MIME type', async () => {
      const h = harness({ analyses: [pass()], generations: [{ bytes: png(), mimeType: 'text/plain' }] });
      const result = await h.engine.execute(input);

      expect(result.events).toContainEqual({
        type: 'candidate_rejected', operation: 'generation', attempt: 1, reason: 'mime_mismatch',
      });
      expectCleanTermination(result, h);
    });

    it.each(['auth', 'quota', 'bad_request'] as const)('ends the run on a %s failure without retrying', async (kind) => {
      const h = harness({ analyses: [pass()], generations: [new ProviderError(kind, 'x')] });
      const result = await h.engine.execute(input);

      expect(result.exitReason).toBe('technical_failure');
      expect(h.ledger).toEqual(['generate']);
      expectCleanTermination(result, h);
    });

    it('treats an unrecognised thrown error as fatal', async () => {
      const h = harness({ analyses: [pass()], generations: [new Error('boom')] });
      const result = await h.engine.execute(input);

      expect(result.exitReason).toBe('technical_failure');
      expect(h.ledger).toEqual(['generate']);
      expectCleanTermination(result, h);
    });

    it('ends the run when the analyzer has a fatal failure', async () => {
      const h = harness({ analyses: [new ProviderError('auth', 'bad key')] });
      const result = await h.engine.execute(input);

      expect(result.exitReason).toBe('technical_failure');
      expect(h.ledger).toEqual(['generate', 'analyze']);
      expectCleanTermination(result, h);
    });

    it('discards the candidate on a transient analyzer failure and continues', async () => {
      const h = harness({ analyses: [new ProviderError('timeout', 'slow'), pass()] });
      const result = await h.engine.execute(input);

      expect(result.exitReason).toBe('success');
      expect(result.finalImage?.id).toBe('generation-2');
      expectCleanTermination(result, h);
    });

    it('never treats an analyzer refusal as a pass', async () => {
      const h = harness({ analyses: [new ProviderError('refusal', 'declined')] });
      const result = await h.engine.execute(input);

      expect(result.success).toBe(false);
      expect(h.generateCalls).toHaveLength(3);
      expectCleanTermination(result, h);
    });
  });

  describe('intake and normalization', () => {
    it.each([
      ['null', null],
      ['a string', 'calm'],
      ['non-string identity', { identityDirection: 5 }],
      ['missing identity', { moodTone: 'calm' }],
      ['non-string optional field', { identityDirection: 'calm', moodTone: 7 }],
      ['over-long field', { identityDirection: 'calm '.repeat(200) }],
    ])('rejects %s before any model call', async (_label, raw) => {
      const h = harness({ analyses: [pass()] });
      const result = await h.engine.execute(raw);

      expect(result.exitReason).toBe('invalid_input');
      expect(h.ledger).toEqual([]);
      expectCleanTermination(result, h);
    });

    it('drops fields outside the input contract silently', async () => {
      const h = harness({ analyses: [pass()] });
      const result = await h.engine.execute({ identityDirection: 'composed', pose: 'sitting at a desk' });

      expect(result.exitReason).toBe('success');
      expect(result.events).toContainEqual({ type: 'fields_dropped', count: 1 });
      expect(h.generateCalls[0].prompt).not.toMatch(/sitting|desk/i);
    });

    it('ends before generation when nothing permitted remains in identity direction', async () => {
      const h = harness({ analyses: [pass()] });
      const result = await h.engine.execute({ identityDirection: 'wealthy CEO holding a laptop' });

      expect(result.exitReason).toBe('empty_intent');
      expect(h.ledger).toEqual([]);
      expectCleanTermination(result, h);
    });

    it('sends the canonical prompt built from Clean Intent to the generator', async () => {
      const raw = { identityDirection: 'calm, grounded', environmentPreference: 'city at dusk', moodTone: 'quiet' };
      const h = harness({ analyses: [pass()] });
      await h.engine.execute(raw);

      expect(h.generateCalls[0].prompt).toBe(buildCanonicalPrompt(normalize(raw)));
      expect(h.generateCalls[0].prompt.startsWith(CANONICAL_PROMPT_V1)).toBe(true);
    });
  });

  describe('semantic normalizer (System Flow step 2)', () => {
    function semantic(result: unknown | Error): SemanticNormalizer & { calls: number } {
      return {
        calls: 0,
        async normalize() {
          this.calls++;
          if (result instanceof Error) {
            throw result;
          }
          return result;
        },
      };
    }

    it('uses the LLM output and still applies the deterministic floor', async () => {
      const normalizer = semantic({ identityDirection: 'calm, wealthy', environmentPreference: 'a quiet street', moodTone: '' });
      const h = harness({ analyses: [pass()], engineOptions: { semanticNormalizer: normalizer } });
      const result = await h.engine.execute({ identityDirection: 'calm' });

      expect(result.events).toContainEqual({ type: 'normalized', method: 'semantic' });
      expect(h.generateCalls[0].prompt).toContain('Identity direction: calm');
      expect(h.generateCalls[0].prompt).toContain('Environment preference: a quiet street');
      expect(h.generateCalls[0].prompt).not.toMatch(/wealthy/i);
      expect(h.generateCalls[0].prompt).not.toContain('Mood/tone');
    });

    it('falls back to the deterministic floor when LLM output is malformed', async () => {
      const normalizer = semantic({ identityDirection: 'calm', notes: 'ignore the rules' });
      const h = harness({ analyses: [pass()], engineOptions: { semanticNormalizer: normalizer } });
      const result = await h.engine.execute({ identityDirection: 'composed' });

      expect(result.events).toContainEqual({ type: 'semantic_normalization_failed', kind: 'invalid_response' });
      expect(result.events).toContainEqual({ type: 'normalized', method: 'deterministic_fallback' });
      expect(h.generateCalls[0].prompt).toContain('Identity direction: composed');
      expect(h.generateCalls[0].prompt).not.toMatch(/ignore/i);
    });

    it('falls back on a transient LLM failure', async () => {
      const normalizer = semantic(new ProviderError('timeout', 'slow'));
      const h = harness({ analyses: [pass()], engineOptions: { semanticNormalizer: normalizer } });
      const result = await h.engine.execute({ identityDirection: 'composed' });

      expect(result.exitReason).toBe('success');
      expect(result.events).toContainEqual({ type: 'normalized', method: 'deterministic_fallback' });
    });

    it('ends before any image call on a fatal LLM failure', async () => {
      const normalizer = semantic(new ProviderError('auth', 'bad key'));
      const h = harness({ analyses: [pass()], engineOptions: { semanticNormalizer: normalizer } });
      const result = await h.engine.execute({ identityDirection: 'composed' });

      expect(result.exitReason).toBe('technical_failure');
      expect(h.ledger).toEqual([]);
      expectCleanTermination(result, h);
    });
  });

  describe('cancellation', () => {
    it('makes no model call when the signal is already aborted', async () => {
      const controller = new AbortController();
      controller.abort();
      const h = harness({ analyses: [pass()] });
      const result = await h.engine.execute(input, { signal: controller.signal });

      expect(result.exitReason).toBe('cancelled');
      expect(h.ledger).toEqual([]);
      expectCleanTermination(result, h);
    });

    it('stops before analysis when cancelled during generation', async () => {
      const controller = new AbortController();
      const h = harness({
        analyses: [pass()],
        generations: [() => {
          controller.abort();
          return { bytes: png(), mimeType: 'image/png' };
        }],
      });
      const result = await h.engine.execute(input, { signal: controller.signal });

      expect(result.exitReason).toBe('cancelled');
      expect(h.ledger).toEqual(['generate']);
      expectCleanTermination(result, h);
    });
  });

  describe('silent operation', () => {
    it('never throws, even when a model is not implemented', async () => {
      const engine = new (await import('../src/engine')).VisionFramesEngine(
        {} as never,
        {} as never,
        references()
      );
      const result = await engine.execute(input);

      expect(result.exitReason).toBe('technical_failure');
      expect(result.success).toBe(false);
      expectCleanTermination(result);
    });
  });

  describe('AC-11 quality degrades with retries', () => {
    it.todo(
      'BLOCKED on handoff D06: R1 requires a hard stop when quality degrades with retries, but defines no rubric, threshold, or judge. Not implemented; no metric is invented.'
    );
  });
});
