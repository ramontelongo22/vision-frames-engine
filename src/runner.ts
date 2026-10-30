/**
 * Vision Frames - Local Runner (development tool, not a user interface)
 *
 * Runs one frame execution, or one v2 board of 3, 7 or 9 frames, and writes the result
 * to a local folder.
 *
 *   Offline, no credentials:
 *     npm run frame -- --mock --identity "calm, grounded" [--scenario pass|refine|stop]
 *     npm run frame -- --mock --board 7 --identity "calm, grounded" [--place "a quiet street at dusk" ...] \
 *       [--scenario pass|refine|stop|partial|quota] [--concurrency 1]
 *
 *   Live provider calls (paid; needs GEMINI_API_KEY and OPENAI_API_KEY):
 *     npm run frame -- --live --ref me-1.jpg --ref me-2.jpg --identity "calm, grounded" \
 *       [--environment "a quiet street at dusk"] [--mood "steady"] [--no-semantic] [--out out/run-1]
 *     npm run frame -- --live --board 3 --ref me-1.jpg --identity "calm, grounded" [--place "..." ...]
 *
 * Live mode never starts without the explicit --live flag. One frame makes at most
 * 3 generation calls, 2 refinement calls, one analysis per candidate, and one language
 * cleanup call (on by default, V2-03; --no-semantic turns it off); a board makes up to
 * that for every frame. Mock mode never makes the cleanup call.
 *
 * Mock analyzer scripts are shared by every frame of a board in call order, so the
 * partial and quota scenarios split predictably only with --concurrency 1.
 *
 * Output: frame.<ext> (or frame-<position>.<ext> and board.jpg for a board) for what is
 * delivered, and run.json with internal diagnostics (counts, events, per-call timings,
 * model ids, SDK versions). run.json never contains user text, prompts, or image bytes.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { parseArgs } from 'util';
import { VisionFramesBoard } from './board';
import { isBoardSize } from './boardPlaces';
import { BOARD } from './config';
import {
  BOARD_MOCK_SCENARIOS,
  MOCK_QUOTA_GENERATION,
  MOCK_SCENARIOS,
  MockImageGenerationModel,
  MockScenario,
  ScriptedAnalysisModel,
  mockScenarioScript,
} from './dev/mockModels';
import { toPublicBoardOutcome, toPublicOutcome } from './delivery';
import { EngineOptions, EngineResult, ImageAnalysisModel, ImageGenerationModel, VisionFramesEngine } from './engine';
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
    allowNegative: true,
    options: {
      mock: { type: 'boolean', default: false },
      live: { type: 'boolean', default: false },
      scenario: { type: 'string', default: 'refine' },
      ref: { type: 'string', multiple: true, default: [] },
      identity: { type: 'string' },
      environment: { type: 'string' },
      mood: { type: 'string' },
      // Language cleanup is on by default in live mode (V2-03); --no-semantic turns it off
      semantic: { type: 'boolean', default: true },
      board: { type: 'string' },
      place: { type: 'string', multiple: true, default: [] },
      concurrency: { type: 'string' },
      out: { type: 'string', default: 'out/run' },
      help: { type: 'boolean', default: false },
    },
  });

  if (values.help || values.mock === values.live) {
    console.error('Usage: npm run frame -- (--mock | --live) --identity "..." [--ref file ...] [--environment "..."] [--mood "..."] [--out dir]');
    console.error('       npm run frame -- (--mock | --live) --board 3|7|9 --identity "..." [--place "..." ...] [--concurrency n]');
    console.error('Exactly one of --mock or --live is required. --live makes paid provider calls,');
    console.error('including one language cleanup call per frame unless --no-semantic is given.');
    return 2;
  }

  const boardSize = values.board === undefined ? undefined : Number(values.board);
  if (boardSize !== undefined && !isBoardSize(boardSize)) {
    console.error(`--board must be one of ${BOARD.sizes.join(', ')}`);
    return 2;
  }
  if (boardSize === undefined && (values.place.length > 0 || values.concurrency !== undefined)) {
    console.error('--place and --concurrency need --board');
    return 2;
  }
  if (boardSize !== undefined && values.environment !== undefined) {
    console.error('A board takes one --place per frame instead of --environment');
    return 2;
  }
  const concurrency = values.concurrency === undefined ? BOARD.concurrency : Number(values.concurrency);
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    console.error('--concurrency must be a positive whole number');
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
    const allowed = boardSize === undefined ? MOCK_SCENARIOS.filter((s) => !BOARD_MOCK_SCENARIOS.includes(s)) : MOCK_SCENARIOS;
    if (!allowed.includes(scenario)) {
      console.error(`--scenario must be one of ${allowed.join(', ')}`);
      return 2;
    }
    generator = new MockImageGenerationModel(scenario === 'quota' ? MOCK_QUOTA_GENERATION : {});
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

  const outDir = resolve(values.out);
  mkdirSync(outDir, { recursive: true });
  const context = {
    models,
    versions: {
      node: process.version,
      '@google/genai': packageVersion('@google/genai'),
      openai: packageVersion('openai'),
    },
    references: references.length,
  };
  const started = new Date();

  if (boardSize !== undefined) {
    const board = new VisionFramesBoard(instrumentedGenerator, instrumentedAnalyzer, references, {
      concurrency,
      engineOptions,
    });
    const result = await board.execute({
      size: boardSize,
      identityDirection: values.identity,
      moodTone: values.mood,
      places: values.place,
    });
    const durationMs = Date.now() - started.getTime();

    const outcome = toPublicBoardOutcome(result);
    const written: string[] = [];
    for (const frame of result.frames) {
      const image = frame.status === 'delivered' ? frame.result?.finalImage : undefined;
      if (image) {
        const path = join(outDir, `frame-${frame.position}.${EXTENSIONS[image.mimeType] ?? 'bin'}`);
        writeFileSync(path, image.bytes);
        written.push(path);
      }
    }
    let boardPath: string | undefined;
    if (outcome.status === 'delivered' && outcome.boardImage) {
      boardPath = join(outDir, 'board.jpg');
      writeFileSync(boardPath, outcome.boardImage.bytes);
    }

    const record = {
      startedAt: started.toISOString(),
      durationMs,
      ...context,
      concurrency,
      publicOutcome: outcome.status,
      board: {
        size: result.size ?? null,
        exitReason: result.exitReason,
        halted: result.halted ?? null,
        deliveredCount: result.deliveredCount,
        refundedCount: result.refundedCount,
        // Tester phase: no money moves; this is what would have been refunded (V2-02)
        refundDue: result.size ? `${result.refundedCount}/${result.size} of the board price` : null,
        boardImage: result.boardImage ? { width: result.boardImage.width, height: result.boardImage.height } : null,
        events: result.events,
      },
      frames: result.frames.map((frame) => ({
        position: frame.position,
        placeSource: frame.placeSource,
        status: frame.status,
        ...(frame.result ? frameRecord(frame.result) : {}),
      })),
      timings,
      providerResponses,
    };
    writeFileSync(join(outDir, 'run.json'), `${JSON.stringify(record, null, 2)}\n`);

    const delivered = outcome.status === 'delivered' ? `, ${outcome.frames.length} of ${outcome.framesOrdered} frames` : '';
    console.log(`public outcome: ${outcome.status}${delivered}${boardPath ? ` (${boardPath})` : ''}`);
    console.log(
      `internal: ${result.exitReason}${result.halted ? ` (halted: ${result.halted})` : ''}, delivered ${result.deliveredCount}, refunded ${result.refundedCount}, run.json in ${outDir}`
    );
    return 0;
  }

  const engine = new VisionFramesEngine(instrumentedGenerator, instrumentedAnalyzer, references, engineOptions);
  const result = await engine.execute({
    identityDirection: values.identity,
    environmentPreference: values.environment,
    moodTone: values.mood,
  });
  const durationMs = Date.now() - started.getTime();

  const outcome = toPublicOutcome(result);
  let framePath: string | undefined;
  if (outcome.status === 'delivered') {
    framePath = join(outDir, `frame.${EXTENSIONS[outcome.image.mimeType] ?? 'bin'}`);
    writeFileSync(framePath, outcome.image.bytes);
  }

  const record = {
    startedAt: started.toISOString(),
    durationMs,
    ...context,
    publicOutcome: outcome.status,
    ...frameRecord(result),
    timings,
    providerResponses,
  };
  writeFileSync(join(outDir, 'run.json'), `${JSON.stringify(record, null, 2)}\n`);

  console.log(`public outcome: ${outcome.status}${framePath ? ` (${framePath})` : ''}`);
  console.log(
    `internal: ${result.exitReason}, generations ${result.generationAttempts}/3, refinements ${result.refinementAttempts}/2, run.json in ${outDir}`
  );
  return 0;
}

/** Internal diagnostics for one frame: counts, violations, image metadata and events */
function frameRecord(result: EngineResult) {
  return {
    exitReason: result.exitReason,
    generationAttempts: result.generationAttempts,
    refinementAttempts: result.refinementAttempts,
    violations: result.violations,
    finalImage: result.finalImage
      ? { id: result.finalImage.id, mimeType: result.finalImage.mimeType, width: result.finalImage.width, height: result.finalImage.height }
      : null,
    events: result.events,
  };
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
