/**
 * Vision Frames v1 - Nano Banana (Gemini) Image Generation Model
 * Single source of truth: spec/VisionFrames_v1.pdf System Flow steps 4 and 6
 *
 * "Call image model with canonical prompt + references". Every request carries the
 * validated reference image bytes; refinements also carry the QA-passing base image.
 *
 * Provider facts checked against Google's documentation on 2026-10-28
 * (docs/DECISIONS.md P-10): gemini-3-pro-image-preview, the model the baseline used,
 * was shut down on 2026-06-25; gemini-3-pro-image is its GA successor. The model id is
 * configurable because provider model ids change.
 *
 * The adapter never retries. Each call the engine counts is exactly one HTTP request:
 * SDK retries are off, and so is the SDK's automatic continuation, which by default
 * resends a request (billed again) whenever a reply ends with finish reason CONTINUATION.
 * A reply that ends that way is a failed attempt. Only the image is requested back
 * (responseModalities IMAGE), so no output text is paid for.
 */

import {
  ApiError,
  FinishReason,
  GenerateContentConfig,
  GenerateContentParameters,
  GenerateContentResponse,
  GoogleGenAI,
  Part,
} from '@google/genai';
import { GenerationCall, ImageGenerationModel, RefinementCall } from './engine';
import { ProviderError } from './errors';
import { ImagePayload, ValidatedImage } from './images';
import { ProviderMetadataListener } from './providerMetadata';

export const DEFAULT_GEMINI_IMAGE_MODEL = 'gemini-3-pro-image';
export const DEFAULT_GEMINI_TIMEOUT_MS = 180_000;
/** R1 sets no shape; the owner chose 16:9 landscape frames on 2026-10-30 (V2-02) */
export const DEFAULT_GEMINI_ASPECT_RATIO = '16:9';

/** Role labels so the provider knows what each attached image is for */
export const REFERENCE_IMAGES_LABEL = 'Reference images of the user:';
export const BASE_IMAGE_LABEL = 'Image to edit:';

/** The one SDK method the adapter uses; injectable so requests can be captured in tests */
export interface GeminiModelsClient {
  generateContent(params: GenerateContentParameters): Promise<GenerateContentResponse>;
}

export interface NanoBananaOptions {
  apiKey?: string;
  /** Inject a client instead of an API key (tests, custom transport) */
  client?: GeminiModelsClient;
  model?: string;
  timeoutMs?: number;
  /** Defaults to DEFAULT_GEMINI_ASPECT_RATIO */
  aspectRatio?: string;
  /** Not fixed by R1; left to the provider default unless set */
  imageSize?: string;
  /** Receives non-content metadata (served model, usage) for every response */
  onResponse?: ProviderMetadataListener;
}

const REFUSAL_FINISH_REASONS = new Set<string>([
  FinishReason.SAFETY,
  FinishReason.RECITATION,
  FinishReason.BLOCKLIST,
  FinishReason.PROHIBITED_CONTENT,
  FinishReason.SPII,
  FinishReason.IMAGE_SAFETY,
  FinishReason.IMAGE_PROHIBITED_CONTENT,
  FinishReason.IMAGE_RECITATION,
]);

export class NanoBananaImageGenerationModel implements ImageGenerationModel {
  readonly model: string;
  private readonly client: GeminiModelsClient;
  private readonly imageConfig: GenerateContentConfig['imageConfig'];
  private readonly onResponse?: ProviderMetadataListener;

  constructor(options: NanoBananaOptions) {
    this.model = options.model ?? DEFAULT_GEMINI_IMAGE_MODEL;
    this.onResponse = options.onResponse;

    if (options.client) {
      this.client = options.client;
    } else {
      if (!options.apiKey) {
        throw new ProviderError('auth', 'Gemini API key is not configured');
      }
      const ai = new GoogleGenAI({
        apiKey: options.apiKey,
        httpOptions: {
          timeout: options.timeoutMs ?? DEFAULT_GEMINI_TIMEOUT_MS,
          retryOptions: { attempts: 1 },
        },
      });
      this.client = ai.models;
    }

    this.imageConfig = {
      aspectRatio: options.aspectRatio || DEFAULT_GEMINI_ASPECT_RATIO,
      ...(options.imageSize ? { imageSize: options.imageSize } : {}),
    };
  }

  /**
   * Generate one candidate from the canonical prompt and the reference images
   */
  async generate(call: GenerationCall): Promise<ImagePayload> {
    const parts: Part[] = [{ text: call.prompt }, ...referenceParts(call.references)];
    return this.request('generate', parts, call.signal);
  }

  /**
   * Edit the QA-passing base image with a system-owned refinement prompt.
   * The references are sent again so likeness stays anchored to the user, not only to
   * the base image.
   */
  async refine(call: RefinementCall): Promise<ImagePayload> {
    const parts: Part[] = [
      { text: call.prompt },
      { text: BASE_IMAGE_LABEL },
      inlinePart(call.baseImage),
      ...referenceParts(call.references),
    ];
    return this.request('refine', parts, call.signal);
  }

  private async request(operation: 'generate' | 'refine', parts: Part[], signal?: AbortSignal): Promise<ImagePayload> {
    const params: GenerateContentParameters = {
      model: this.model,
      contents: [{ role: 'user', parts }],
      config: {
        responseModalities: ['IMAGE'],
        // Do not keep request logs (which contain the user's photos) at the provider
        store: false,
        // One counted attempt must stay one billed request (P-04)
        automaticContinuation: false,
        imageConfig: this.imageConfig,
        ...(signal ? { abortSignal: signal } : {}),
      },
    };

    let response: GenerateContentResponse;
    try {
      response = await this.client.generateContent(params);
    } catch (error) {
      throw classifyGeminiError(error, signal);
    }
    this.onResponse?.({
      provider: 'gemini',
      operation,
      requestedModel: this.model,
      servedModel: response?.modelVersion,
      responseId: response?.responseId,
      status: response?.candidates?.[0]?.finishReason ?? response?.promptFeedback?.blockReason,
      usage: response?.usageMetadata,
    });
    return extractImage(response);
  }
}

function referenceParts(references: readonly ValidatedImage[]): Part[] {
  if (references.length === 0) {
    throw new ProviderError('bad_request', 'reference images are required for every image request');
  }
  return [{ text: REFERENCE_IMAGES_LABEL }, ...references.map(inlinePart)];
}

function inlinePart(image: ValidatedImage): Part {
  return {
    inlineData: {
      mimeType: image.mimeType,
      data: Buffer.from(image.bytes).toString('base64'),
    },
  };
}

/**
 * Pull the generated image out of a generateContent response. Text-only, blocked, or
 * malformed responses are failures, never images.
 */
export function extractImage(response: unknown): ImagePayload {
  const r = (response ?? {}) as Partial<GenerateContentResponse>;

  const blockReason = r.promptFeedback?.blockReason;
  if (blockReason) {
    throw new ProviderError('refusal', `prompt blocked: ${blockReason}`);
  }

  const candidates = r.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw new ProviderError('no_image', 'response contained no candidates');
  }

  const candidate = candidates[0];
  const finishReason = candidate?.finishReason;
  if (finishReason && REFUSAL_FINISH_REASONS.has(finishReason)) {
    throw new ProviderError('refusal', `generation stopped: ${finishReason}`);
  }
  // Automatic continuation is off, so this reply is unfinished; it is never an image
  if (finishReason === FinishReason.CONTINUATION) {
    throw new ProviderError('invalid_response', 'generation stopped before it finished (CONTINUATION)');
  }

  const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
  // Interim "thought" images are drafts, not the answer
  const imageParts = parts.filter(
    (part) =>
      part &&
      part.thought !== true &&
      typeof part.inlineData?.data === 'string' &&
      (part.inlineData.mimeType === undefined || part.inlineData.mimeType.startsWith('image/'))
  );
  if (imageParts.length === 0) {
    throw new ProviderError('no_image', `response contained no image (finish reason: ${finishReason ?? 'none'})`);
  }

  const inlineData = imageParts[imageParts.length - 1].inlineData!;
  const bytes = decodeBase64Strict(inlineData.data!);
  if (!bytes) {
    throw new ProviderError('invalid_response', 'image data is not valid base64');
  }
  return { bytes, mimeType: inlineData.mimeType };
}

function decodeBase64Strict(data: string): Uint8Array | null {
  const compact = data.replace(/\s+/g, '');
  if (compact.length === 0 || compact.length % 4 === 1 || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(compact)) {
    return null;
  }
  const bytes = Buffer.from(compact, 'base64');
  return bytes.length > 0 ? bytes : null;
}

/**
 * Map SDK and transport errors to engine failure kinds
 */
export function classifyGeminiError(error: unknown, signal?: AbortSignal): ProviderError {
  if (error instanceof ProviderError) {
    return error;
  }
  if (signal?.aborted) {
    return new ProviderError('cancelled', 'request cancelled', { cause: error });
  }
  if (error instanceof ApiError) {
    const status = error.status;
    const message = error.message ?? '';
    let kind: ProviderError['kind'] = 'unknown';
    if (status === 401 || status === 403) {
      kind = 'auth';
    } else if (status === 429) {
      kind = /quota|billing/i.test(message) ? 'quota' : 'rate_limit';
    } else if (status === 408 || status === 504) {
      kind = 'timeout';
    } else if (status >= 500) {
      kind = 'server';
    } else if (status >= 400) {
      kind = 'bad_request';
    }
    return new ProviderError(kind, `Gemini API error (status ${status})`, { status, cause: error });
  }
  const name = (error as { name?: unknown } | null)?.name;
  if (name === 'TimeoutError' || name === 'AbortError') {
    return new ProviderError('timeout', 'Gemini request timed out', { cause: error });
  }
  if (error instanceof TypeError) {
    return new ProviderError('network', 'Gemini request failed to connect', { cause: error });
  }
  return new ProviderError('unknown', 'Gemini request failed', { cause: error });
}
