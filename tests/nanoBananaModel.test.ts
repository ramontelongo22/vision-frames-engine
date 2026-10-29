/**
 * Vision Frames v1 - Gemini Adapter Tests (AC-05, AC-06, AC-15)
 *
 * Every test captures the outbound request with an injected client; no network calls.
 */

import { ApiError, GenerateContentParameters, GenerateContentResponse } from '@google/genai';
import { ProviderError } from '../src/errors';
import { CandidateImage, ReferenceImage, validateImageBytes } from '../src/images';
import {
  BASE_IMAGE_LABEL,
  DEFAULT_GEMINI_IMAGE_MODEL,
  GeminiModelsClient,
  NanoBananaImageGenerationModel,
  REFERENCE_IMAGES_LABEL,
  classifyGeminiError,
  extractImage,
} from '../src/nanoBananaModel';
import { buildCanonicalPrompt } from '../src/promptBuilder';
import { buildRefinementPrompt } from '../src/refinement';
import { jpeg, png } from './helpers';

function reference(bytes: Buffer, id: string): ReferenceImage {
  const result = validateImageBytes(bytes, undefined, { maxBytes: 1e8, minDimension: 1, maxDimension: 1e5 });
  if (!result.ok) {
    throw new Error('fixture');
  }
  return { ...result.image, id };
}

function imageResponse(bytes: Buffer, extraParts: unknown[] = []): GenerateContentResponse {
  return {
    candidates: [
      {
        finishReason: 'STOP',
        content: {
          role: 'model',
          parts: [...extraParts, { inlineData: { mimeType: 'image/png', data: bytes.toString('base64') } }],
        },
      },
    ],
  } as unknown as GenerateContentResponse;
}

class CapturingClient implements GeminiModelsClient {
  readonly requests: GenerateContentParameters[] = [];
  constructor(private readonly respond: () => GenerateContentResponse | Promise<GenerateContentResponse>) {}
  async generateContent(params: GenerateContentParameters): Promise<GenerateContentResponse> {
    this.requests.push(params);
    return this.respond();
  }
}

const refA = reference(png(200, 300, [1, 1, 1]), 'reference-1');
const refB = reference(jpeg(640, 480), 'reference-2');
const prompt = buildCanonicalPrompt({ identityDirection: 'calm' });

type InlinePart = { inlineData?: { mimeType?: string; data?: string }; text?: string };
const partsOf = (request: GenerateContentParameters) =>
  (request.contents as Array<{ role: string; parts: InlinePart[] }>)[0].parts;

describe('NanoBananaImageGenerationModel', () => {
  it('requires a key or an injected client and never falls back to a default credential', () => {
    expect(() => new NanoBananaImageGenerationModel({})).toThrow(ProviderError);
  });

  it('defaults to the GA successor of the historical model', () => {
    const model = new NanoBananaImageGenerationModel({ client: new CapturingClient(() => imageResponse(png())) });
    expect(model.model).toBe(DEFAULT_GEMINI_IMAGE_MODEL);
    expect(DEFAULT_GEMINI_IMAGE_MODEL).toBe('gemini-3-pro-image');
  });

  describe('generate', () => {
    it('sends the canonical prompt and every reference image as inline bytes', async () => {
      const client = new CapturingClient(() => imageResponse(png(320, 180)));
      const model = new NanoBananaImageGenerationModel({ client });

      const payload = await model.generate({ prompt, references: [refA, refB] });

      expect(client.requests).toHaveLength(1);
      const request = client.requests[0];
      expect(request.model).toBe('gemini-3-pro-image');
      const parts = partsOf(request);
      expect(parts[0]).toEqual({ text: prompt });
      expect(parts[1]).toEqual({ text: REFERENCE_IMAGES_LABEL });
      expect(parts[2]).toEqual({ inlineData: { mimeType: 'image/png', data: Buffer.from(refA.bytes).toString('base64') } });
      expect(parts[3]).toEqual({ inlineData: { mimeType: 'image/jpeg', data: Buffer.from(refB.bytes).toString('base64') } });
      expect(parts).toHaveLength(4);
      expect(Buffer.from(payload.bytes).equals(png(320, 180))).toBe(true);
    });

    it('disables provider-side request storage and asks for image output', async () => {
      const client = new CapturingClient(() => imageResponse(png()));
      await new NanoBananaImageGenerationModel({ client }).generate({ prompt, references: [refA] });

      expect(client.requests[0].config?.store).toBe(false);
      expect(client.requests[0].config?.responseModalities).toEqual(['TEXT', 'IMAGE']);
      expect(client.requests[0].config?.imageConfig).toBeUndefined();
    });

    it('passes aspect ratio and size only when configured', async () => {
      const client = new CapturingClient(() => imageResponse(png()));
      await new NanoBananaImageGenerationModel({ client, aspectRatio: '16:9', imageSize: '2K' }).generate({
        prompt,
        references: [refA],
      });
      expect(client.requests[0].config?.imageConfig).toEqual({ aspectRatio: '16:9', imageSize: '2K' });
    });

    it('forwards the run abort signal', async () => {
      const client = new CapturingClient(() => imageResponse(png()));
      const controller = new AbortController();
      await new NanoBananaImageGenerationModel({ client }).generate({ prompt, references: [refA], signal: controller.signal });
      expect(client.requests[0].config?.abortSignal).toBe(controller.signal);
    });

    it('refuses to send a request without references', async () => {
      const client = new CapturingClient(() => imageResponse(png()));
      await expect(new NanoBananaImageGenerationModel({ client }).generate({ prompt, references: [] })).rejects.toMatchObject({
        kind: 'bad_request',
      });
      expect(client.requests).toHaveLength(0);
    });
  });

  describe('refine', () => {
    it('sends the edit prompt, the clean base image, and the references', async () => {
      const client = new CapturingClient(() => imageResponse(png(330, 190)));
      const baseBytes = png(300, 200, [9, 9, 9]);
      const base: CandidateImage = { ...reference(baseBytes, 'x'), id: 'generation-1', origin: 'generation' };
      const editPrompt = buildRefinementPrompt('lighting', prompt);

      await new NanoBananaImageGenerationModel({ client }).refine({
        prompt: editPrompt,
        refinement: 'lighting',
        baseImage: base,
        references: [refA],
      });

      const parts = partsOf(client.requests[0]);
      expect(parts[0]).toEqual({ text: editPrompt });
      expect(parts[1]).toEqual({ text: BASE_IMAGE_LABEL });
      expect(parts[2]).toEqual({ inlineData: { mimeType: 'image/png', data: baseBytes.toString('base64') } });
      expect(parts[3]).toEqual({ text: REFERENCE_IMAGES_LABEL });
      expect(parts[4]).toEqual({ inlineData: { mimeType: 'image/png', data: Buffer.from(refA.bytes).toString('base64') } });
      expect(parts[0].text).toContain(prompt);
    });
  });
});

describe('response metadata', () => {
  it('reports served model and usage for every response, including ones without an image', async () => {
    const seen: unknown[] = [];
    const client = new CapturingClient(() => ({
      modelVersion: 'gemini-3-pro-image-001',
      responseId: 'resp-1',
      usageMetadata: { totalTokenCount: 1234 },
      candidates: [{ finishReason: 'NO_IMAGE', content: { parts: [{ text: 'no' }] } }],
    }) as unknown as GenerateContentResponse);
    const model = new NanoBananaImageGenerationModel({ client, onResponse: (m) => seen.push(m) });

    await expect(model.generate({ prompt, references: [refA] })).rejects.toMatchObject({ kind: 'no_image' });
    expect(seen).toEqual([
      {
        provider: 'gemini',
        operation: 'generate',
        requestedModel: 'gemini-3-pro-image',
        servedModel: 'gemini-3-pro-image-001',
        responseId: 'resp-1',
        status: 'NO_IMAGE',
        usage: { totalTokenCount: 1234 },
      },
    ]);
    expect(JSON.stringify(seen)).not.toContain(Buffer.from(refA.bytes).toString('base64'));
  });
});

describe('extractImage', () => {
  it('returns the final non-thought image and skips interim thought images', () => {
    const draft = png(64, 64, [1, 0, 0]);
    const final = png(64, 64, [0, 0, 1]);
    const response = imageResponse(final, [
      { text: 'thinking', thought: true },
      { thought: true, inlineData: { mimeType: 'image/png', data: draft.toString('base64') } },
    ]);
    expect(Buffer.from(extractImage(response).bytes).equals(final)).toBe(true);
  });

  it('passes the declared MIME through without inventing one', () => {
    const response = {
      candidates: [{ content: { parts: [{ inlineData: { data: png().toString('base64') } }] } }],
    };
    expect(extractImage(response).mimeType).toBeUndefined();
  });

  it.each([
    ['a missing response', undefined, 'no_image'],
    ['no candidates', { candidates: [] }, 'no_image'],
    ['an empty candidate', { candidates: [{}] }, 'no_image'],
    ['a text-only answer', { candidates: [{ content: { parts: [{ text: 'I cannot do that' }] } }] }, 'no_image'],
    [
      'a non-image inline part',
      { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'text/plain', data: 'aGVsbG8=' } }] } }] },
      'no_image',
    ],
    [
      'malformed base64',
      { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: '***not base64***' } }] } }] },
      'invalid_response',
    ],
    ['a blocked prompt', { promptFeedback: { blockReason: 'PROHIBITED_CONTENT' } }, 'refusal'],
    ['an image safety stop', { candidates: [{ finishReason: 'IMAGE_SAFETY', content: { parts: [] } }] }, 'refusal'],
    ['a NO_IMAGE stop', { candidates: [{ finishReason: 'NO_IMAGE', content: { parts: [] } }] }, 'no_image'],
  ])('fails on %s and never returns an image', (_label, response, kind) => {
    expect(() => extractImage(response)).toThrow(ProviderError);
    try {
      extractImage(response);
    } catch (error) {
      expect((error as ProviderError).kind).toBe(kind);
    }
  });
});

describe('classifyGeminiError', () => {
  it.each([
    [401, 'API key not valid', 'auth'],
    [403, 'permission denied', 'auth'],
    [404, 'models/gemini-3-pro-image-preview is not found', 'bad_request'],
    [400, 'invalid argument', 'bad_request'],
    [429, 'Resource has been exhausted', 'rate_limit'],
    [429, 'You exceeded your current quota, check billing', 'quota'],
    [500, 'internal', 'server'],
    [503, 'unavailable', 'server'],
    [504, 'deadline exceeded', 'timeout'],
  ])('maps HTTP %i (%s) to %s', (status, message, kind) => {
    expect(classifyGeminiError(new ApiError({ status, message })).kind).toBe(kind);
  });

  it('maps a fired run signal to cancelled', () => {
    const controller = new AbortController();
    controller.abort();
    expect(classifyGeminiError(new Error('aborted'), controller.signal).kind).toBe('cancelled');
  });

  it('maps an SDK timeout abort to timeout and a fetch failure to network', () => {
    expect(classifyGeminiError(Object.assign(new Error('t'), { name: 'TimeoutError' })).kind).toBe('timeout');
    expect(classifyGeminiError(new TypeError('fetch failed')).kind).toBe('network');
    expect(classifyGeminiError(new Error('???')).kind).toBe('unknown');
  });

  it('turns client errors into ProviderErrors through generate', async () => {
    const client = new CapturingClient(() => {
      throw new ApiError({ status: 401, message: 'bad key' });
    });
    await expect(new NanoBananaImageGenerationModel({ client }).generate({ prompt, references: [refA] })).rejects.toMatchObject({
      kind: 'auth',
      status: 401,
    });
  });
});
