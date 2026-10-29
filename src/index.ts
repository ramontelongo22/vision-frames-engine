/**
 * Vision Frames v1 - Main Entry Point
 * Single source of truth: spec/VisionFrames_v1.pdf
 */

export type { CleanIntent, RawInput } from './schema';
export { normalize } from './normalize';
export { buildCanonicalPrompt, CANONICAL_PROMPT_V1 } from './promptBuilder';
export { checkQAGate, validateAnalysis, validateAnalysisReport, VIOLATION_LABELS } from './qaGate';
export type { QAResult, ImageAnalysis, AnalysisReport, ViolationCode } from './qaGate';
export { REFINEMENT_TYPES, buildRefinementPrompt } from './refinement';
export type { RefinementType } from './refinement';
export { CONFIG, LIMITS } from './config';
export { validateImageBytes } from './images';
export { convertHeicToJpeg, isHeic } from './heic';
export type { HeicConversion } from './heic';
export type { CandidateImage, ImagePayload, ImageMimeType, ReferenceImage, ValidatedImage } from './images';
export { ProviderError, FATAL_FAILURE_KINDS } from './errors';
export type { ProviderFailureKind } from './errors';
export type { SemanticNormalizer } from './semanticNormalizer';
export type { ProviderResponseMetadata, ProviderMetadataListener } from './providerMetadata';
export { VisionFramesEngine } from './engine';
export type {
  AnalysisCall,
  EngineEvent,
  EngineOptions,
  EngineResult,
  ExecuteOptions,
  ExitReason,
  GenerationCall,
  ImageAnalysisModel,
  ImageGenerationModel,
  RefinementCall,
} from './engine';
export { toPublicOutcome } from './delivery';
export type { PublicOutcome } from './delivery';
export { NanoBananaImageGenerationModel, DEFAULT_GEMINI_IMAGE_MODEL } from './nanoBananaModel';
export { OpenAIImageAnalysisModel, DEFAULT_OPENAI_ANALYSIS_MODEL } from './openAIAnalysisModel';
export { OpenAISemanticNormalizer } from './openAISemanticNormalizer';
