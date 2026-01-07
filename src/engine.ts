/**
 * Vision Frames v1 - State Machine Engine
 * Single source of truth: /spec/VisionFrames_v1.pdf Sections 7-8 (System Flow)
 *
 * Exact state machine:
 * - Generation loop max 3 → QA gate
 * - Refinement loop max 2 (lighting/env tone/minor framing still wide only) → QA gate
 * - Exit: success or silent stop (attempts exhausted or hard stop triggered)
 *
 * No UI. Stub model calls as interfaces.
 */

import { normalize } from './normalize';
import { buildCanonicalPrompt } from './promptBuilder';
import { checkQAGate, QAResult, ImageAnalysis } from './qaGate';
import { CONFIG } from './config';

export interface RawInput {
  identityDirection: string;
  environmentPreference?: string;
  moodTone?: string;
}

export interface GeneratedImage {
  id: string;
  data: unknown; // Stub for actual image data
}

export interface RefinementRequest {
  type: 'lighting' | 'environment_tone' | 'minor_framing';
  description: string;
}

/**
 * Interface for image generation model (stub)
 */
export interface ImageGenerationModel {
  generate(prompt: string, referenceImages: unknown[]): Promise<GeneratedImage>;
  refine(image: GeneratedImage, refinement: RefinementRequest): Promise<GeneratedImage>;
}

/**
 * Interface for image analysis model (stub)
 */
export interface ImageAnalysisModel {
  analyze(image: GeneratedImage): Promise<ImageAnalysis>;
}

export type ExitReason =
  | 'success'
  | 'generations_exhausted'
  | 'likeness_failed_twice'
  | 'repeat_violations';

export interface EngineResult {
  success: boolean;
  exitReason: ExitReason;
  finalImage?: GeneratedImage;
  generationAttempts: number;
  refinementAttempts: number;
  violations: string[][];
}

/**
 * Hard stop conditions per PDF Section 7
 */
interface HardStopState {
  likenessFailures: number;
  lastViolations: Set<string>;
  violationRepeated: boolean;
}

/**
 * Vision Frames v1 State Machine Engine
 */
export class VisionFramesEngine {
  constructor(
    private generationModel: ImageGenerationModel,
    private analysisModel: ImageAnalysisModel,
    private referenceImages: unknown[]
  ) {}

  /**
   * Execute the complete Vision Frames v1 pipeline
   * Per PDF System Flow (pages 8-12)
   */
  async execute(rawInput: RawInput): Promise<EngineResult> {
    // Step 2: Normalize & Filter
    const cleanIntent = normalize(rawInput);

    // Step 3: Compose Canonical Prompt
    const canonicalPrompt = buildCanonicalPrompt(cleanIntent);

    const violations: string[][] = [];
    let generationAttempts = 0;
    let refinementAttempts = 0;

    const hardStop: HardStopState = {
      likenessFailures: 0,
      lastViolations: new Set(),
      violationRepeated: false,
    };

    // Step 4: Generate Attempt Loop (max 3 generations)
    for (let gen = 0; gen < CONFIG.maxGenerations; gen++) {
      generationAttempts++;

      // Generate image
      const image = await this.generationModel.generate(
        canonicalPrompt,
        this.referenceImages
      );

      // Step 5: Automated QA Gate
      const analysis = await this.analysisModel.analyze(image);
      const qaResult = checkQAGate(analysis);

      violations.push(qaResult.violations);

      // Check for hard stop conditions
      if (this.shouldHardStop(qaResult, hardStop)) {
        return {
          success: false,
          exitReason: this.determineHardStopReason(hardStop),
          generationAttempts,
          refinementAttempts,
          violations,
        };
      }

      if (qaResult.passed) {
        // Step 6: Refinement Loop (max 2 refinements)
        const refinementResult = await this.executeRefinementLoop(
          image,
          hardStop
        );

        refinementAttempts = refinementResult.attempts;
        violations.push(...refinementResult.violations);

        if (refinementResult.success && refinementResult.finalImage) {
          // Success exit
          return {
            success: true,
            exitReason: 'success',
            finalImage: refinementResult.finalImage,
            generationAttempts,
            refinementAttempts,
            violations,
          };
        }

        // If refinement failed, continue to next generation if attempts remain
      }

      // Update hard stop state
      this.updateHardStopState(qaResult, hardStop);
    }

    // Step 7: Exit - Generations exhausted
    return {
      success: false,
      exitReason: 'generations_exhausted',
      generationAttempts,
      refinementAttempts,
      violations,
    };
  }

  /**
   * Execute refinement loop (max 2 refinements)
   * Only allowed: lighting, environment tone, minor framing (still wide)
   */
  private async executeRefinementLoop(
    baseImage: GeneratedImage,
    hardStop: HardStopState
  ): Promise<{
    success: boolean;
    finalImage?: GeneratedImage;
    attempts: number;
    violations: string[][];
  }> {
    let currentImage = baseImage;
    const violations: string[][] = [];

    // System-owned refinement sequence (hardcoded, max 2)
    const refinementSequence: RefinementRequest[] = [
      { type: 'lighting', description: '' },
      { type: 'environment_tone', description: '' },
    ];

    for (let ref = 0; ref < CONFIG.maxRefinements; ref++) {
      // Apply refinement
      const refinement = refinementSequence[ref];
      currentImage = await this.generationModel.refine(currentImage, refinement);

      // Re-run QA gate after refinement
      const analysis = await this.analysisModel.analyze(currentImage);
      const qaResult = checkQAGate(analysis);

      violations.push(qaResult.violations);

      if (qaResult.passed) {
        return {
          success: true,
          finalImage: currentImage,
          attempts: ref + 1,
          violations,
        };
      }

      // Check hard stop
      if (this.shouldHardStop(qaResult, hardStop)) {
        return {
          success: false,
          attempts: ref + 1,
          violations,
        };
      }

      this.updateHardStopState(qaResult, hardStop);
    }

    return {
      success: false,
      attempts: CONFIG.maxRefinements,
      violations,
    };
  }

  /**
   * Check if hard stop should be triggered
   * Per PDF Section 7: likeness fails twice, same violation repeats
   */
  private shouldHardStop(qaResult: QAResult, hardStop: HardStopState): boolean {
    // Likeness failed twice
    if (hardStop.likenessFailures >= 2) {
      return true;
    }

    // Same violation repeats
    if (hardStop.violationRepeated) {
      return true;
    }

    return false;
  }

  /**
   * Update hard stop state after each QA check
   */
  private updateHardStopState(qaResult: QAResult, hardStop: HardStopState): void {
    // Track likeness failures
    if (qaResult.violations.includes('Likeness drifts or feels AI/stock')) {
      hardStop.likenessFailures++;
    }

    // Check if any violation repeats from last attempt
    if (qaResult.violations.length > 0 && hardStop.lastViolations.size > 0) {
      for (const violation of qaResult.violations) {
        if (hardStop.lastViolations.has(violation)) {
          hardStop.violationRepeated = true;
          break;
        }
      }
    }

    // Track last violations
    hardStop.lastViolations = new Set(qaResult.violations);
  }

  /**
   * Determine the specific hard stop reason
   */
  private determineHardStopReason(hardStop: HardStopState): ExitReason {
    if (hardStop.likenessFailures >= 2) {
      return 'likeness_failed_twice';
    }

    if (hardStop.violationRepeated) {
      return 'repeat_violations';
    }

    return 'generations_exhausted';
  }
}
