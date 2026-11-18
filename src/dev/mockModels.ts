/**
 * Deterministic offline models for the runner's --mock mode and for tests.
 * No network, no credentials. Output images are real PNGs; findings are scripted.
 */

import { AnalysisCall, GenerationCall, ImageAnalysisModel, ImageGenerationModel, RefinementCall } from '../engine';
import { ProviderError, ProviderFailureKind } from '../errors';
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

export interface MockGenerationOptions {
  /** Every call from this 1-based call number on throws a ProviderError of `failureKind` */
  failFromCall?: number;
  failureKind?: ProviderFailureKind;
}

export class MockImageGenerationModel implements ImageGenerationModel {
  readonly calls: Array<{ operation: 'generate'; call: GenerationCall } | { operation: 'refine'; call: RefinementCall }> = [];

  constructor(private readonly options: MockGenerationOptions = {}) {}

  async generate(call: GenerationCall): Promise<ImagePayload> {
    this.calls.push({ operation: 'generate', call });
    this.failIfScripted();
    return { bytes: encodeSolidPng(160, 90, [24, 28, 40 + this.calls.length * 10]), mimeType: 'image/png' };
  }

  async refine(call: RefinementCall): Promise<ImagePayload> {
    this.calls.push({ operation: 'refine', call });
    this.failIfScripted();
    return { bytes: encodeSolidPng(160, 90, [40, 32, 24 + this.calls.length * 10]), mimeType: 'image/png' };
  }

  private failIfScripted(): void {
    const { failFromCall, failureKind = 'quota' } = this.options;
    if (failFromCall !== undefined && this.calls.length >= failFromCall) {
      throw new ProviderError(failureKind, `mock ${failureKind} failure`);
    }
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

export type MockScenario = 'pass' | 'refine' | 'stop' | 'partial' | 'quota';

export const MOCK_SCENARIOS: readonly MockScenario[] = ['pass', 'refine', 'stop', 'partial', 'quota'];

/** Scenarios that only make sense on a board */
export const BOARD_MOCK_SCENARIOS: readonly MockScenario[] = ['partial', 'quota'];

/**
 * Scripted analyzer reports, consumed in call order across every frame of a run.
 * - partial: on a board run one frame at a time, frame 2 fails likeness twice and is
 *   refunded while every other frame passes.
 * - quota: every report passes; pair it with MOCK_QUOTA_GENERATION so the provider
 *   runs out of quota on the third generation call.
 */
export function mockScenarioScript(scenario: MockScenario): AnalysisReport[] {
  const likeness: AnalysisReport = { findings: { ...CLEAN_FINDINGS, likenessIssue: true }, refinement: null };
  switch (scenario) {
    case 'partial':
      return [{ findings: CLEAN_FINDINGS, refinement: null }, likeness, likeness, { findings: CLEAN_FINDINGS, refinement: null }];
    case 'quota':
    case 'pass':
      return [{ findings: CLEAN_FINDINGS, refinement: null }];
    case 'refine':
      return [
        { findings: CLEAN_FINDINGS, refinement: 'lighting' },
        { findings: CLEAN_FINDINGS, refinement: null },
      ];
    case 'stop':
      return [likeness];
  }
}

export const MOCK_QUOTA_GENERATION: MockGenerationOptions = { failFromCall: 3, failureKind: 'quota' };
