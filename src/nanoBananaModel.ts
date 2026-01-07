/**
 * Vision Frames v1 - NanoBanana Image Generation Model
 * Production implementation using Gemini gemini-3-pro-image-preview
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import {
  ImageGenerationModel,
  GeneratedImage,
  RefinementRequest,
} from './engine';

interface ImageData {
  buffer: Buffer;
  mimeType: string;
}

/**
 * Production-ready image generation model using Gemini
 */
export class NanoBananaImageGenerationModel implements ImageGenerationModel {
  private genAI: GoogleGenerativeAI;
  private modelName = 'gemini-3-pro-image-preview';

  constructor(apiKey: string) {
    this.genAI = new GoogleGenerativeAI(apiKey);
  }

  /**
   * Generate image from prompt
   */
  async generate(
    prompt: string,
    referenceImages: unknown[]
  ): Promise<GeneratedImage> {
    const model = this.genAI.getGenerativeModel({ model: this.modelName });

    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
    });

    const imageData = await this.extractImageData(result);

    return {
      id: this.generateId(),
      data: imageData,
    };
  }

  /**
   * Refine existing image with refinement request
   */
  async refine(
    image: GeneratedImage,
    refinement: RefinementRequest
  ): Promise<GeneratedImage> {
    const model = this.genAI.getGenerativeModel({ model: this.modelName });

    const refinementPrompt = this.buildRefinementPrompt(refinement);

    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: refinementPrompt }] }],
    });

    const imageData = await this.extractImageData(result);

    return {
      id: this.generateId(),
      data: imageData,
    };
  }

  /**
   * Build refinement prompt from refinement request
   */
  private buildRefinementPrompt(refinement: RefinementRequest): string {
    const basePrompt = refinement.description || '';

    switch (refinement.type) {
      case 'lighting':
        return `Adjust lighting. ${basePrompt}`.trim();
      case 'environment_tone':
        return `Adjust environment tone. ${basePrompt}`.trim();
      case 'minor_framing':
        return `Adjust framing (keep wide). ${basePrompt}`.trim();
      default:
        return basePrompt;
    }
  }

  /**
   * Extract image data from generation result
   */
  private async extractImageData(result: any): Promise<ImageData> {
    const response = await result.response;
    const candidates = response.candidates;

    if (!candidates || candidates.length === 0) {
      throw new Error('No image generated');
    }

    const candidate = candidates[0];
    const parts = candidate.content?.parts || [];

    for (const part of parts) {
      if (part.inlineData) {
        const buffer = Buffer.from(part.inlineData.data, 'base64');
        return {
          buffer,
          mimeType: part.inlineData.mimeType || 'image/png',
        };
      }
    }

    throw new Error('No image data in response');
  }

  /**
   * Generate unique ID
   */
  private generateId(): string {
    return `img-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }
}
