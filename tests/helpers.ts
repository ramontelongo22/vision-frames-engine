/**
 * Shared test fixtures: real image bytes, scripted models, and run-ledger assertions.
 */

import { encodeSolidPng } from '../src/dev/png';
import { CLEAN_FINDINGS } from '../src/dev/mockModels';
import {
  AnalysisCall,
  EngineOptions,
  EngineResult,
  GenerationCall,
  ImageAnalysisModel,
  ImageGenerationModel,
  RefinementCall,
  VisionFramesEngine,
} from '../src/engine';
import { ImagePayload } from '../src/images';
import { AnalysisReport, ImageAnalysis } from '../src/qaGate';
import { RefinementType } from '../src/refinement';

export { CLEAN_FINDINGS };

export function png(width = 128, height = 96, rgb: [number, number, number] = [10, 20, 30]): Buffer {
  return encodeSolidPng(width, height, rgb);
}

/** Minimal structurally valid JPEG: SOI, APP0, SOF0 with dimensions, EOI */
export function jpeg(width: number, height: number): Buffer {
  const app0 = [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00];
  const sof0 = [
    0xff, 0xc0, 0x00, 0x11, 0x08,
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
  ];
  return Buffer.from([0xff, 0xd8, ...app0, ...sof0, 0xff, 0xd9]);
}

/** Minimal WebP container header with a VP8X chunk carrying canvas size */
export function webpVp8x(width: number, height: number): Buffer {
  const b = Buffer.alloc(30);
  b.write('RIFF', 0, 'ascii');
  b.writeUInt32LE(22, 4);
  b.write('WEBP', 8, 'ascii');
  b.write('VP8X', 12, 'ascii');
  b.writeUInt32LE(10, 16);
  b.writeUIntLE(width - 1, 24, 3);
  b.writeUIntLE(height - 1, 27, 3);
  return b;
}

export function references(count = 2): Array<{ bytes: Buffer; mimeType: string }> {
  return Array.from({ length: count }, (_, i) => ({
    bytes: png(200 + i, 300, [100 + i, 80, 60]),
    mimeType: 'image/png',
  }));
}

export function pass(refinement: RefinementType | null = null): AnalysisReport {
  return { findings: { ...CLEAN_FINDINGS }, refinement };
}

export function fail(...fields: Array<keyof ImageAnalysis>): AnalysisReport {
  const findings = { ...CLEAN_FINDINGS };
  for (const field of fields) {
    findings[field] = true;
  }
  return { findings, refinement: null };
}

type Scripted<T> = T | Error | (() => T | Error);

export interface HarnessOptions {
  /** Analyzer results in call order; the last entry repeats */
  analyses: Array<Scripted<unknown>>;
  /** Generator results in call order; defaults to a fresh valid PNG per call */
  generations?: Array<Scripted<ImagePayload>>;
  /** Refinement results in call order; defaults to a fresh valid PNG per call */
  refinements?: Array<Scripted<ImagePayload>>;
  references?: unknown[];
  engineOptions?: EngineOptions;
}

export interface Harness {
  engine: VisionFramesEngine;
  /** Every model call in order: 'generate', 'refine', 'analyze' */
  ledger: string[];
  generateCalls: GenerationCall[];
  refineCalls: RefinementCall[];
  analyzeCalls: AnalysisCall[];
  inputReferences: unknown[];
}

function resolve<T>(entry: Scripted<T> | undefined, fallback: () => T): T {
  const value = typeof entry === 'function' ? (entry as () => T | Error)() : entry;
  if (value instanceof Error) {
    throw value;
  }
  return value === undefined ? fallback() : value;
}

export function harness(options: HarnessOptions): Harness {
  const ledger: string[] = [];
  const generateCalls: GenerationCall[] = [];
  const refineCalls: RefinementCall[] = [];
  const analyzeCalls: AnalysisCall[] = [];
  let imageCounter = 0;
  const freshImage = (): ImagePayload => {
    imageCounter++;
    return { bytes: png(160, 90, [imageCounter * 7, 40, 50]), mimeType: 'image/png' };
  };

  const generator: ImageGenerationModel = {
    async generate(call) {
      ledger.push('generate');
      generateCalls.push(call);
      return resolve(options.generations?.[generateCalls.length - 1], freshImage);
    },
    async refine(call) {
      ledger.push('refine');
      refineCalls.push(call);
      return resolve(options.refinements?.[refineCalls.length - 1], freshImage);
    },
  };

  const analyzer: ImageAnalysisModel = {
    async analyze(call) {
      ledger.push('analyze');
      analyzeCalls.push(call);
      const index = Math.min(analyzeCalls.length - 1, options.analyses.length - 1);
      return resolve(options.analyses[index], () => undefined);
    },
  };

  const inputReferences = options.references ?? references();
  const engine = new VisionFramesEngine(generator, analyzer, inputReferences, options.engineOptions);
  return { engine, ledger, generateCalls, refineCalls, analyzeCalls, inputReferences };
}

/**
 * Invariants every run must satisfy: exactly one terminal event, it is the last event,
 * no model work was requested after it, and recorded counts equal observed calls.
 */
export function expectCleanTermination(result: EngineResult, h?: Harness): void {
  const terminations = result.events.filter((e) => e.type === 'terminated');
  expect(terminations).toHaveLength(1);
  expect(result.events[result.events.length - 1]).toEqual({ type: 'terminated', reason: result.exitReason });

  if (result.success) {
    expect(result.exitReason).toBe('success');
    expect(result.finalImage).toBeDefined();
  } else {
    expect(result.finalImage).toBeUndefined();
  }

  if (h) {
    expect(result.generationAttempts).toBe(h.generateCalls.length);
    expect(result.refinementAttempts).toBe(h.refineCalls.length);
    expect(h.generateCalls.length).toBeLessThanOrEqual(3);
    expect(h.refineCalls.length).toBeLessThanOrEqual(2);
  }
}
