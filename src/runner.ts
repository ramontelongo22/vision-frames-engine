/**
 * Vision Frames v1 - Local Runner (development tool, not a user interface)
 *
 * Runs one frame execution and writes the result to a local folder.
 *
 *   Offline, no credentials:
 *     npm run frame -- --mock --identity "calm, grounded" [--scenario pass|refine|stop]
 *
 *   Live provider calls (paid; needs GEMINI_API_KEY and OPENAI_API_KEY):
 *     npm run frame -- --live --ref me-1.jpg --ref me-2.jpg --identity "calm, grounded" \
 *       [--environment "a quiet street at dusk"] [--mood "steady"] [--semantic] [--out out/run-1]
 *
 * Live mode never starts without the explicit --live flag. One run makes at most
 * 3 generation calls, 2 refinement calls, one analysis per candidate, and (with
 * --semantic) one normalization call.
 *
 * Output: frame.<ext> when a frame is delivered, and run.json with internal diagnostics
 * (counts, events, per-call timings, model ids, SDK versions). run.json never contains
 * user text, prompts, or image bytes.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { parseArgs } from 'util';
import { MockImageGenerationModel, MockScenario, ScriptedAnalysisModel, mockScenarioScript } from './dev/mockModels';
import { toPublicOutcome } from './delivery';
import { EngineOptions, ImageAnalysisModel, ImageGenerationModel, VisionFramesEngine } from './engine';
import { failureKindOf } from './errors';
import { encodeSolidPng } from './dev/png';
import { NanoBananaImageGenerationModel } from './nanoBananaModel';
import { OpenAIImageAnalysisModel } from './openAIAnalysisModel';
import { OpenAISemanticNormalizer } from './openAISemanticNormalizer';
import { ProviderResponseMetadata } from './providerMetadata';

interface CallTiming {
  operation: 'generate' | 'refine' | 'analyze' | 'normalize';
  durationMs: number;
  outcome: 'ok' | string;
}

const EXTENSIONS: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

async function timed<T>(timings: CallTiming[], operation: CallTiming['operation'], call: () => Promise<T>): Promise<T> {
  const started = Date.now();
  try {
    const value = await call();
    timings.push({ operation, durationMs: Date.now() - started, outcome: 'ok' });
    return value;
  } catch (error) {
    timings.push({ operation, durationMs: Date.now() - started, outcome: failureKindOf(error) });
    throw error;
  }
}

function packageVersion(name: string): string | undefined {
  // Packages with an exports map hide package.json from require.resolve, so walk up
  // from the resolved entry point instead.
  try {
    let dir = dirname(require.resolve(name));
    while (dir !== dirname(dir)) {
      const candidate = join(dir, 'package.json');
      if (existsSync(candidate)) {
        const pkg = JSON.parse(readFileSync(candidate, 'utf8')) as { name?: string; version?: string };
        if (pkg.name === name) {
          return pkg.version;
        }
      }
      dir = dirname(dir);
    }
  } catch {
    // fall through
  }
  return undefined;
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      mock: { type: 'boolean', default: false },
      live: { type: 'boolean', default: false },
      scenario: { type: 'string', default: 'refine' },
      ref: { type: 'string', multiple: true, default: [] },
      identity: { type: 'string' },
      environment: { type: 'string' },
      mood: { type: 'string' },
      semantic: { type: 'boolean', default: false },
      out: { type: 'string', default: 'out/run' },
      help: { type: 'boolean', default: false },
    },
  });

  if (values.help || values.mock === values.live) {
    console.error('Usage: npm run frame -- (--mock | --live) --identity "..." [--ref file ...] [--environment "..."] [--mood "..."] [--out dir]');
    console.error('Exactly one of --mock or --live is required. --live makes paid provider calls.');
    return 2;
  }

  const timings: CallTiming[] = [];
  const providerResponses: ProviderResponseMetadata[] = [];
  const onResponse = (metadata: ProviderResponseMetadata) => providerResponses.push(metadata);
  let generator: ImageGenerationModel;
  let analyzer: ImageAnalysisModel;
  const engineOptions: EngineOptions = {};
  const models: Record<string, string> = {};
  let references: Array<{ bytes: Uint8Array }>;

  if (values.mock) {
    const scenario = values.scenario as MockScenario;
    if (!['pass', 'refine', 'stop'].includes(scenario)) {
      console.error('--scenario must be pass, refine, or stop');
      return 2;
    }
    generator = new MockImageGenerationModel();
    analyzer = new ScriptedAnalysisModel(mockScenarioScript(scenario));
    models.mode = `mock:${scenario}`;
    references =
      values.ref.length > 0
        ? values.ref.map((file) => ({ bytes: readFileSync(resolve(file)) }))
        : [{ bytes: encodeSolidPng(256, 256, [90, 80, 70]) }];
  } else {
    const geminiKey = process.env.GEMINI_API_KEY;
    const openaiKey = process.env.OPENAI_API_KEY;
    if (!geminiKey || !openaiKey) {
      console.error('Live mode needs GEMINI_API_KEY and OPENAI_API_KEY in the environment (see .env.example).');
      return 2;
    }
    if (values.ref.length === 0) {
      console.error('Live mode needs at least one --ref reference image.');
      return 2;
    }
    const gemini = new NanoBananaImageGenerationModel({
      apiKey: geminiKey,
      model: process.env.VF_GEMINI_IMAGE_MODEL || undefined,
      aspectRatio: process.env.VF_GEMINI_ASPECT_RATIO || undefined,
      imageSize: process.env.VF_GEMINI_IMAGE_SIZE || undefined,
      onResponse,
    });
    const openai = new OpenAIImageAnalysisModel({
      apiKey: openaiKey,
      model: process.env.VF_OPENAI_ANALYSIS_MODEL || undefined,
      onResponse,
    });
    generator = gemini;
    analyzer = openai;
    models.mode = 'live';
    models.generator = gemini.model;
    models.analyzer = openai.model;
    if (values.semantic) {
      const normalizer = new OpenAISemanticNormalizer({
        apiKey: openaiKey,
        model: process.env.VF_OPENAI_NORMALIZER_MODEL || undefined,
        onResponse,
      });
      models.normalizer = normalizer.model;
      engineOptions.semanticNormalizer = {
        normalize: (input, options) => timed(timings, 'normalize', () => normalizer.normalize(input, options)),
      };
    }
    // File names are never passed on; only bytes are
    references = values.ref.map((file) => ({ bytes: readFileSync(resolve(file)) }));
  }

  const instrumentedGenerator: ImageGenerationModel = {
    generate: (call) => timed(timings, 'generate', () => generator.generate(call)),
    refine: (call) => timed(timings, 'refine', () => generator.refine(call)),
  };
  const instrumentedAnalyzer: ImageAnalysisModel = {
    analyze: (call) => timed(timings, 'analyze', () => analyzer.analyze(call)),
  };

  const engine = new VisionFramesEngine(instrumentedGenerator, instrumentedAnalyzer, references, engineOptions);
  const started = new Date();
  const result = await engine.execute({
    identityDirection: values.identity,
    environmentPreference: values.environment,
    moodTone: values.mood,
  });
  const durationMs = Date.now() - started.getTime();

  const outDir = resolve(values.out);
  mkdirSync(outDir, { recursive: true });

  const outcome = toPublicOutcome(result);
  let framePath: string | undefined;
  if (outcome.status === 'delivered') {
    framePath = join(outDir, `frame.${EXTENSIONS[outcome.image.mimeType] ?? 'bin'}`);
    writeFileSync(framePath, outcome.image.bytes);
  }

  const record = {
    startedAt: started.toISOString(),
    durationMs,
    models,
    versions: {
      node: process.version,
      '@google/genai': packageVersion('@google/genai'),
      openai: packageVersion('openai'),
    },
    references: references.length,
    publicOutcome: outcome.status,
    exitReason: result.exitReason,
    generationAttempts: result.generationAttempts,
    refinementAttempts: result.refinementAttempts,
    violations: result.violations,
    finalImage: result.finalImage
      ? { id: result.finalImage.id, mimeType: result.finalImage.mimeType, width: result.finalImage.width, height: result.finalImage.height }
      : null,
    timings,
    providerResponses,
    events: result.events,
  };
  writeFileSync(join(outDir, 'run.json'), `${JSON.stringify(record, null, 2)}\n`);

  console.log(`public outcome: ${outcome.status}${framePath ? ` (${framePath})` : ''}`);
  console.log(
    `internal: ${result.exitReason}, generations ${result.generationAttempts}/3, refinements ${result.refinementAttempts}/2, run.json in ${outDir}`
  );
  return 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
);
