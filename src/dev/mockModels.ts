/**
 * Deterministic offline models for the runner's --mock mode and for tests.
 * No network, no credentials. Output images are real PNGs; findings are scripted.
 */

import { AnalysisCall, GenerationCall, ImageAnalysisModel, ImageGenerationModel, RefinementCall } from '../engine';
import { ImagePayload } from '../images';
import { AnalysisReport, ImageAnalysis } from '../qaGate';
import { encodeSolidPng } from './png';

export const CLEAN_FINDINGS: ImageAnalysis = {
  isSeated: false,
  hasObjects: false,
  hasMultiplePeople: false,
  hasActionWorkOrGesture: false,
  likenessIssue: false,
  isOverStylized: false,
  hasWealthSignaling: false,
  isCloseUpOrExtremeAngle: false,
};

export class MockImageGenerationModel implements ImageGenerationModel {
  readonly calls: Array<{ operation: 'generate'; call: GenerationCall } | { operation: 'refine'; call: RefinementCall }> = [];

  async generate(call: GenerationCall): Promise<ImagePayload> {
    this.calls.push({ operation: 'generate', call });
    return { bytes: encodeSolidPng(160, 90, [24, 28, 40 + this.calls.length * 10]), mimeType: 'image/png' };
  }

  async refine(call: RefinementCall): Promise<ImagePayload> {
    this.calls.push({ operation: 'refine', call });
    return { bytes: encodeSolidPng(160, 90, [40, 32, 24 + this.calls.length * 10]), mimeType: 'image/png' };
  }
}

/**
 * Returns the scripted reports in order; the last one repeats if the run asks for more.
 */
export class ScriptedAnalysisModel implements ImageAnalysisModel {
  readonly calls: AnalysisCall[] = [];

  constructor(private readonly script: readonly unknown[]) {}

  async analyze(call: AnalysisCall): Promise<unknown> {
    const report = this.script[Math.min(this.calls.length, this.script.length - 1)];
    this.calls.push(call);
    return report;
  }
}

export type MockScenario = 'pass' | 'refine' | 'stop';

export function mockScenarioScript(scenario: MockScenario): AnalysisReport[] {
  switch (scenario) {
    case 'pass':
      return [{ findings: CLEAN_FINDINGS, refinement: null }];
    case 'refine':
      return [
        { findings: CLEAN_FINDINGS, refinement: 'lighting' },
        { findings: CLEAN_FINDINGS, refinement: null },
      ];
    case 'stop':
      return [{ findings: { ...CLEAN_FINDINGS, likenessIssue: true }, refinement: null }];
  }
}
