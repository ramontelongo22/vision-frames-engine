/**
 * OpenAI image generator (O-06 comparison only). Injected client; no network calls.
 */

import OpenAI from 'openai';
import { ProviderError } from '../src/errors';
import { CandidateImage, ReferenceImage, validateImageBytes } from '../src/images';
import {
  DEFAULT_OPENAI_IMAGE_MODEL,
  DEFAULT_OPENAI_IMAGE_SIZE,
  OpenAIImageGenerationModel,
  OpenAIImagesClient,
} from '../src/openAIImageModel';
import { png } from './helpers';

function reference(bytes: Buffer, id: string): ReferenceImage {
  const result = validateImageBytes(bytes, undefined, { maxBytes: 1e8, minDimension: 1, maxDimension: 1e5 });
  if (!result.ok) {
    throw new Error('fixture');
  }
  return { ...result.image, id };
}

class CapturingClient implements OpenAIImagesClient {
  calls: OpenAI.Images.ImageEditParamsNonStreaming[] = [];
  constructor(private readonly respond: () => Promise<OpenAI.Images.ImagesResponse>) {}
  edit(params: OpenAI.Images.ImageEditParamsNonStreaming) {
    this.calls.push(params);
    return this.respond();
  }
}

const out = png(8, 8);
const ok = () => Promise.resolve({ created: 0, data: [{ b64_json: out.toString('base64') }] } as OpenAI.Images.ImagesResponse);

describe('OpenAIImageGenerationModel', () => {
  const refs = [reference(png(4, 4), 'r1'), reference(png(6, 6), 'r2')];

  it('sends the prompt and every reference to images.edit at 16:9', async () => {
    const client = new CapturingClient(ok);
    const model = new OpenAIImageGenerationModel({ client });
    const result = await model.generate({ prompt: 'P', references: refs });
    expect(Buffer.from(result.bytes).equals(out)).toBe(true);
    const call = client.calls[0];
    expect(call.model).toBe(DEFAULT_OPENAI_IMAGE_MODEL);
    expect(call.size).toBe(DEFAULT_OPENAI_IMAGE_SIZE);
    expect(call.prompt).toBe('P');
    expect((call.image as unknown[]).length).toBe(2);
  });

  it('puts the base image first on refinement', async () => {
    const client = new CapturingClient(ok);
    const model = new OpenAIImageGenerationModel({ client });
    const base = { ...reference(png(5, 5), 'b'), id: 'b' } as unknown as CandidateImage;
    await model.refine({ prompt: 'R', refinement: 'lighting', baseImage: base, references: refs });
    const files = client.calls[0].image as File[];
    expect(files.length).toBe(3);
    expect(files[0].size).toBe(base.bytes.length);
  });

  it('treats a reply without an image as a failure', async () => {
    const client = new CapturingClient(() => Promise.resolve({ created: 0, data: [] } as OpenAI.Images.ImagesResponse));
    const model = new OpenAIImageGenerationModel({ client });
    await expect(model.generate({ prompt: 'P', references: refs })).rejects.toMatchObject({ kind: 'no_image' });
  });

  it('refuses to call without references', async () => {
    const model = new OpenAIImageGenerationModel({ client: new CapturingClient(ok) });
    await expect(model.generate({ prompt: 'P', references: [] })).rejects.toBeInstanceOf(ProviderError);
  });
});
