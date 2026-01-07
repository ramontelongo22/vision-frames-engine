/**
 * Vision Frames v1 - Engine Tests
 * Tests counters and exit conditions
 */

import {
  VisionFramesEngine,
  ImageGenerationModel,
  ImageAnalysisModel,
  GeneratedImage,
  RawInput,
} from '../src/engine';
import { ImageAnalysis } from '../src/qaGate';
import { CONFIG } from '../src/config';

// Mock models
class MockGenerationModel implements ImageGenerationModel {
  public generateCallCount = 0;
  public refineCallCount = 0;
  public mockAnalysis: ImageAnalysis = {
    isSeated: false,
    hasObjects: false,
    hasMultiplePeople: false,
    hasActionWorkOrGesture: false,
    likenessIssue: false,
    isOverStylized: false,
    hasWealthSignaling: false,
    isCloseUpOrExtremeAngle: false,
  };

  async generate(): Promise<GeneratedImage> {
    this.generateCallCount++;
    return {
      id: `image-${this.generateCallCount}`,
      data: {},
    };
  }

  async refine(image: GeneratedImage): Promise<GeneratedImage> {
    this.refineCallCount++;
    return {
      id: `${image.id}-refined-${this.refineCallCount}`,
      data: {},
    };
  }

  setMockAnalysis(analysis: Partial<ImageAnalysis>) {
    this.mockAnalysis = { ...this.mockAnalysis, ...analysis };
  }
}

class MockAnalysisModel implements ImageAnalysisModel {
  constructor(private mockAnalysis: () => ImageAnalysis) {}

  async analyze(): Promise<ImageAnalysis> {
    return this.mockAnalysis();
  }
}

describe('VisionFramesEngine', () => {
  describe('generation counter limits', () => {
    it('should stop after max generations (3)', async () => {
      const genModel = new MockGenerationModel();
      genModel.setMockAnalysis({ isSeated: true }); // Always fail

      const analysisModel = new MockAnalysisModel(() => genModel.mockAnalysis);
      const engine = new VisionFramesEngine(genModel, analysisModel, []);

      const input: RawInput = {
        identityDirection: 'calm presence',
      };

      const result = await engine.execute(input);

      expect(result.success).toBe(false);
      expect(result.generationAttempts).toBe(CONFIG.maxGenerations);
      expect(genModel.generateCallCount).toBe(CONFIG.maxGenerations);
      expect(result.exitReason).toBe('generations_exhausted');
    });

    it('should not exceed max generations', async () => {
      const genModel = new MockGenerationModel();
      genModel.setMockAnalysis({ hasObjects: true }); // Always fail

      const analysisModel = new MockAnalysisModel(() => genModel.mockAnalysis);
      const engine = new VisionFramesEngine(genModel, analysisModel, []);

      const input: RawInput = {
        identityDirection: 'grounded individual',
      };

      const result = await engine.execute(input);

      expect(genModel.generateCallCount).toBeLessThanOrEqual(CONFIG.maxGenerations);
      expect(result.generationAttempts).toBeLessThanOrEqual(CONFIG.maxGenerations);
    });
  });

  describe('refinement counter limits', () => {
    it('should allow up to max refinements (2)', async () => {
      const genModel = new MockGenerationModel();
      let analyzeCallCount = 0;

      const analysisModel = new MockAnalysisModel(() => {
        analyzeCallCount++;
        // First call (initial generation) passes
        if (analyzeCallCount === 1) {
          return {
            isSeated: false,
            hasObjects: false,
            hasMultiplePeople: false,
            hasActionWorkOrGesture: false,
            likenessIssue: false,
            isOverStylized: false,
            hasWealthSignaling: false,
            isCloseUpOrExtremeAngle: false,
          };
        }
        // Second call (first refinement) fails with hasObjects
        if (analyzeCallCount === 2) {
          return {
            isSeated: false,
            hasObjects: true,
            hasMultiplePeople: false,
            hasActionWorkOrGesture: false,
            likenessIssue: false,
            isOverStylized: false,
            hasWealthSignaling: false,
            isCloseUpOrExtremeAngle: false,
          };
        }
        // Third call (second refinement) fails with hasMultiplePeople
        return {
          isSeated: false,
          hasObjects: false,
          hasMultiplePeople: true,
          hasActionWorkOrGesture: false,
          likenessIssue: false,
          isOverStylized: false,
          hasWealthSignaling: false,
          isCloseUpOrExtremeAngle: false,
        };
      });

      const engine = new VisionFramesEngine(genModel, analysisModel, []);

      const input: RawInput = {
        identityDirection: 'composed',
      };

      const result = await engine.execute(input);

      // Should call refine up to max refinements
      expect(genModel.refineCallCount).toBe(CONFIG.maxRefinements);
      expect(genModel.refineCallCount).toBeLessThanOrEqual(CONFIG.maxRefinements);
      expect(result.success).toBe(false);
    });
  });

  describe('exit conditions', () => {
    it('should exit with success when image passes QA', async () => {
      const genModel = new MockGenerationModel();
      genModel.setMockAnalysis({}); // Clean analysis

      const analysisModel = new MockAnalysisModel(() => genModel.mockAnalysis);
      const engine = new VisionFramesEngine(genModel, analysisModel, []);

      const input: RawInput = {
        identityDirection: 'calm and grounded',
      };

      const result = await engine.execute(input);

      expect(result.success).toBe(true);
      expect(result.exitReason).toBe('success');
      expect(result.finalImage).toBeDefined();
    });

    it('should exit with generations_exhausted after 3 failed attempts', async () => {
      const genModel = new MockGenerationModel();
      genModel.setMockAnalysis({ isSeated: true });

      const analysisModel = new MockAnalysisModel(() => genModel.mockAnalysis);
      const engine = new VisionFramesEngine(genModel, analysisModel, []);

      const input: RawInput = {
        identityDirection: 'presence',
      };

      const result = await engine.execute(input);

      expect(result.success).toBe(false);
      expect(result.exitReason).toBe('generations_exhausted');
      expect(result.generationAttempts).toBe(3);
    });

    it('should hard stop on likeness_failed_twice', async () => {
      const genModel = new MockGenerationModel();
      genModel.setMockAnalysis({ likenessIssue: true });

      const analysisModel = new MockAnalysisModel(() => genModel.mockAnalysis);
      const engine = new VisionFramesEngine(genModel, analysisModel, []);

      const input: RawInput = {
        identityDirection: 'arrival moment',
      };

      const result = await engine.execute(input);

      expect(result.success).toBe(false);
      expect(result.exitReason).toBe('likeness_failed_twice');
      expect(result.generationAttempts).toBeLessThan(3);
    });

    it('should hard stop on repeat_violations', async () => {
      const genModel = new MockGenerationModel();

      // Same violation repeated
      genModel.setMockAnalysis({ hasObjects: true });

      const analysisModel = new MockAnalysisModel(() => genModel.mockAnalysis);
      const engine = new VisionFramesEngine(genModel, analysisModel, []);

      const input: RawInput = {
        identityDirection: 'composed individual',
      };

      const result = await engine.execute(input);

      expect(result.success).toBe(false);
      expect(result.exitReason).toBe('repeat_violations');
      expect(result.generationAttempts).toBeLessThanOrEqual(3);
    });
  });

  describe('violations tracking', () => {
    it('should track all violations across attempts', async () => {
      const genModel = new MockGenerationModel();
      genModel.setMockAnalysis({ isSeated: true });

      const analysisModel = new MockAnalysisModel(() => genModel.mockAnalysis);
      const engine = new VisionFramesEngine(genModel, analysisModel, []);

      const input: RawInput = {
        identityDirection: 'grounded',
      };

      const result = await engine.execute(input);

      expect(result.violations.length).toBeGreaterThan(0);
      expect(result.violations.every(v => v.includes('Subject is seated'))).toBe(true);
    });
  });

  describe('silent operation', () => {
    it('should complete without throwing errors on failure', async () => {
      const genModel = new MockGenerationModel();
      genModel.setMockAnalysis({ hasMultiplePeople: true });

      const analysisModel = new MockAnalysisModel(() => genModel.mockAnalysis);
      const engine = new VisionFramesEngine(genModel, analysisModel, []);

      const input: RawInput = {
        identityDirection: 'calm',
      };

      await expect(engine.execute(input)).resolves.toBeDefined();
    });
  });
});
