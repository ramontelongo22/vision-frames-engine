/**
 * Vision Frames v1 - Provider Response Metadata
 *
 * Non-content facts about each provider response (model actually served, response id,
 * status, token usage), reported through an optional adapter callback so live runs can
 * be evidenced and costed. Never contains prompts, user text, or image bytes.
 */

export interface ProviderResponseMetadata {
  provider: 'gemini' | 'openai';
  operation: 'generate' | 'refine' | 'analyze' | 'normalize';
  requestedModel: string;
  servedModel?: string;
  responseId?: string;
  /** Gemini finish reason or OpenAI response status */
  status?: string;
  /** Provider usage block as returned (token counts) */
  usage?: unknown;
}

export type ProviderMetadataListener = (metadata: ProviderResponseMetadata) => void;
