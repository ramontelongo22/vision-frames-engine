/**
 * Vision Frames v1 - Main Entry Point
 * Single source of truth: /spec/VisionFrames_v1.pdf
 */

export { CleanIntent } from './schema';
export { normalize } from './normalize';
export { buildCanonicalPrompt } from './promptBuilder';
export { checkQAGate, QAResult, ImageAnalysis } from './qaGate';
export { CONFIG } from './config';
export {
  VisionFramesEngine,
  RawInput,
  GeneratedImage,
  RefinementRequest,
  ImageGenerationModel,
  ImageAnalysisModel,
  ExitReason,
  EngineResult,
} from './engine';
