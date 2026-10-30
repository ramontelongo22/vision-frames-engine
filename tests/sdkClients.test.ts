/**
 * Vision Frames - real SDK client settings (P-04, P-10)
 *
 * The adapter suites inject fake clients, so they never exercise the clients the adapters
 * build from an API key. Here the real @google/genai and openai clients run against a
 * stubbed fetch: no network, no credentials. The point is to prove, through the SDKs
 * themselves, that one counted attempt is exactly one HTTP request and that the request
 * settings the decisions log relies on actually reach the wire.
 */

import { ProviderError } from '../src/errors';
import { ReferenceImage, validateImageBytes } from '../src/images';
import { NanoBananaImageGenerationModel } from '../src/nanoBananaModel';
import { CandidateImage } from '../src/images';
import { OpenAIImageAnalysisModel } from '../src/openAIAnalysisModel';
import { CLEAN_FINDINGS, png } from './helpers';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

interface StubbedCall {
  url: string;
  body: Record<string, unknown>;
}

/** Replace fetch with a stub that answers from `responses` in order (the last one repeats) */
function stubFetch(responses: Array<{ status: number; body: unknown }>): StubbedCall[] {
  const calls: StubbedCall[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : {} });
    const next = responses[Math.min(calls.length - 1, responses.length - 1)];
    return new Response(JSON.stringify(next.body), {
      status: next.status,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return calls;
}

function reference(bytes: Buffer, id: string): ReferenceImage {
  const result = validateImageBytes(bytes, 'image/png', { maxBytes: 1e8, minDimension: 1, maxDimension: 1e5 });
  if (!result.ok) {
    throw new Error('fixture');
  }
  return { ...result.image, id };
}

const ref = reference(png(200, 300), 'ref-1');

describe('Gemini adapter with the real @google/genai client', () => {
  const imageReply = {
    candidates: [
      {
        finishReason: 'STOP',
        content: { role: 'model', parts: [{ inlineData: { mimeType: 'image/png', data: png(160, 90).toString('base64') } }] },
      },
    ],
  };

  it('sends store false and asks for the image only, without sending SDK-only options', async () => {
    const calls = stubFetch([{ status: 200, body: imageReply }]);
    const model = new NanoBananaImageGenerationModel({ apiKey: 'test-key' });

    const payload = await model.generate({ prompt: 'prompt', references: [ref] });

    expect(payload.mimeType).toBe('image/png');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('models/gemini-3-pro-image:generateContent');
    expect(calls[0].body.store).toBe(false);
    expect(calls[0].body.generationConfig).toMatchObject({ responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '16:9' } });
    expect(JSON.stringify(calls[0].body)).not.toContain('automaticContinuation');
  });

  it('makes one request for a CONTINUATION reply and counts it as a failed attempt', async () => {
    // Left on, the SDK's automatic continuation would send a second, billed request and
    // return the image from it
    const calls = stubFetch([
      {
        status: 200,
        body: { candidates: [{ finishReason: 'CONTINUATION', continuationToken: 'dG9rZW4=', content: { role: 'model', parts: [] } }] },
      },
      { status: 200, body: imageReply },
    ]);
    const model = new NanoBananaImageGenerationModel({ apiKey: 'test-key' });

    await expect(model.generate({ prompt: 'prompt', references: [ref] })).rejects.toMatchObject({ kind: 'invalid_response' });
    expect(calls).toHaveLength(1);
  });

  it('does not retry a server error', async () => {
    const calls = stubFetch([{ status: 503, body: { error: { code: 503, message: 'unavailable', status: 'UNAVAILABLE' } } }]);
    const model = new NanoBananaImageGenerationModel({ apiKey: 'test-key' });

    const error = await model.generate({ prompt: 'prompt', references: [ref] }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect((error as ProviderError).kind).toBe('server');
    expect(calls).toHaveLength(1);
  });
});

describe('OpenAI adapters with the real openai client', () => {
  const candidate: CandidateImage = { ...reference(png(160, 90), 'x'), id: 'generation-1', origin: 'generation' };

  it('sends store false and parses a completed structured reply', async () => {
    const report = { findings: { ...CLEAN_FINDINGS }, refinement: null };
    const calls = stubFetch([
      {
        status: 200,
        body: {
          id: 'resp_1',
          object: 'response',
          model: 'gpt-6-astra',
          status: 'completed',
          output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: JSON.stringify(report) }] }],
        },
      },
    ]);
    const analyzer = new OpenAIImageAnalysisModel({ apiKey: 'test-key' });

    await expect(analyzer.analyze({ candidate, references: [ref] })).resolves.toEqual(report);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('/responses');
    expect(calls[0].body).toMatchObject({ model: 'gpt-6-astra', store: false });
  });

  it('does not retry a server error', async () => {
    const calls = stubFetch([{ status: 500, body: { error: { message: 'server error', type: 'server_error' } } }]);
    const analyzer = new OpenAIImageAnalysisModel({ apiKey: 'test-key' });

    const error = await analyzer.analyze({ candidate, references: [ref] }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect((error as ProviderError).kind).toBe('server');
    expect(calls).toHaveLength(1);
  });
});
