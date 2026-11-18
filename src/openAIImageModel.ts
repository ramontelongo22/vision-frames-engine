/**
 * Vision Frames - OpenAI Image Generation Model (O-06 live comparison only)
 *
 * Lets the live test run OpenAI as the image maker in place of Gemini, with the same
 * canonical prompt, the same reference images, the same engine limits and the same QA
 * analyzer, so the two providers can be compared on identical inputs. It is selected
 * only with the runner's --generator openai flag; Gemini stays the default generator.
 *
 * Every request goes to v1/images/edits, because only that endpoint accepts the user's
 * reference photos (the SDK allows up to 16 input images). A refinement sends the
 * QA-passing base image first, then the references, matching the Gemini adapter's order.
 *
 * Provider facts checked on 2026-11-18 against developers.openai.com and the openai
 * 7.45.1 type definitions: gpt-image-2.5-sunburst is listed as OpenAI's most capable
 * generation and editing model and supports arbitrary WIDTHxHEIGHT sizes (both sides
 * divisible by 16), so 1536x864 gives the same 16:9 shape as the Gemini frames (V2-02).
 * The 2.6 models are newer but the SDK does not yet document their size support.
 *
 * Like the other adapters it never retries: SDK retries are off, so each counted
 * attempt is exactly one request.
 */

import OpenAI, { toFile } from 'openai';
import { GenerationCall, ImageGenerationModel, RefinementCall } from './engine';
import { ProviderError } from './errors';
import { ImagePayload, ValidatedImage } from './images';
import { classifyOpenAIError } from './openAIAnalysisModel';
import { ProviderMetadataListener } from './providerMetadata';

export const DEFAULT_OPENAI_IMAGE_MODEL = 'gpt-image-2.5-sunburst';
/** 16:9, matching DEFAULT_GEMINI_ASPECT_RATIO; both sides divisible by 16 */
export const DEFAULT_OPENAI_IMAGE_SIZE = '1536x864';
export const DEFAULT_OPENAI_IMAGE_TIMEOUT_MS = 240_000;

/** The one SDK method the adapter uses; injectable so requests can be captured in tests */
export interface OpenAIImagesClient {
  edit(params: OpenAI.Images.ImageEditParamsNonStreaming): Promise<OpenAI.Images.ImagesResponse>;
}

export interface OpenAIImageOptions {
  apiKey?: string;
  client?: OpenAIImagesClient;
  model?: string;
  size?: string;
  /** Left to the provider default unless set */
  quality?: OpenAI.Images.ImageEditParams['quality'];
  timeoutMs?: number;
  onResponse?: ProviderMetadataListener;
}

const EXTENSIONS: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

export class OpenAIImageGenerationModel implements ImageGenerationModel {
  readonly model: string;
  readonly size: string;
  private readonly quality?: OpenAI.Images.ImageEditParams['quality'];
  private readonly client: OpenAIImagesClient;
  private readonly onResponse?: ProviderMetadataListener;

  constructor(options: OpenAIImageOptions) {
    this.model = options.model ?? DEFAULT_OPENAI_IMAGE_MODEL;
    this.size = options.size ?? DEFAULT_OPENAI_IMAGE_SIZE;
    this.quality = options.quality;
    this.onResponse = options.onResponse;
    if (options.client) {
      this.client = options.client;
    } else {
      if (!options.apiKey) {
        throw new ProviderError('auth', 'OpenAI API key is not configured');
      }
      const openai = new OpenAI({
        apiKey: options.apiKey,
        maxRetries: 0,
        timeout: options.timeoutMs ?? DEFAULT_OPENAI_IMAGE_TIMEOUT_MS,
      });
      this.client = openai.images;
    }
  }

  async generate(call: GenerationCall): Promise<ImagePayload> {
    return this.request('generate', call.prompt, call.references, undefined, call.signal);
  }

  async refine(call: RefinementCall): Promise<ImagePayload> {
    return this.request('refine', call.prompt, call.references, call.baseImage, call.signal);
  }

  private async request(
    operation: 'generate' | 'refine',
    prompt: string,
    references: readonly ValidatedImage[],
    baseImage: ValidatedImage | undefined,
    signal?: AbortSignal
  ): Promise<ImagePayload> {
    if (references.length === 0) {
      throw new ProviderError('bad_request', 'reference images are required for every image request');
    }
    const images = [...(baseImage ? [baseImage] : []), ...references];
    const files = await Promise.all(
      images.map((image, index) =>
        // Neutral names only; the user's file names never leave the machine
        toFile(Buffer.from(image.bytes), `image-${index + 1}.${EXTENSIONS[image.mimeType] ?? 'png'}`, {
          type: image.mimeType,
        })
      )
    );

    let response: OpenAI.Images.ImagesResponse;
    try {
      response = await this.client.edit({
        model: this.model,
        prompt,
        image: files,
        n: 1,
        size: this.size,
        output_format: 'png',
        ...(this.quality ? { quality: this.quality } : {}),
      });
    } catch (error) {
      throw classifyOpenAIError(error, signal);
    }

    this.onResponse?.({
      provider: 'openai',
      operation,
      requestedModel: this.model,
      servedModel: this.model,
      responseId: undefined,
      status: response?.data?.[0]?.b64_json ? 'image' : 'no_image',
      usage: response?.usage,
    });

    const b64 = response?.data?.[0]?.b64_json;
    if (!b64) {
      throw new ProviderError('no_image', 'OpenAI response contained no image');
    }
    return { bytes: new Uint8Array(Buffer.from(b64, 'base64')), mimeType: 'image/png' };
  }
}
