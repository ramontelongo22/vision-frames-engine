# Vision Frames v1 engine

TypeScript engine for Vision Frames v1: identity-first, photorealistic still images of a future
version of the user in a grounded moment of presence. This is not a vision board, cinematic
reel, fantasy, or productivity simulation.

**Single source of truth:** [`spec/VisionFrames_v1.pdf`](spec/VisionFrames_v1.pdf)
("Vision Frames v1 - Rules & Flow", frozen). If it is not allowed there, it is not allowed here.

## Status

| Area | State |
|------|-------|
| Engine control flow (caps, hard stops, refinement, fail-closed QA) | Implemented; covered by mocked tests |
| iPhone HEIC reference photos | Converted to JPEG on intake; tested with libheif-made files, not yet with photos from an iPhone |
| Gemini image generation and refinement adapter | Implemented; request shape tested offline; **no live call made yet** |
| OpenAI reference-aware QA analyzer | Implemented; request shape tested offline; **no live call made yet** |
| Optional LLM normalization step | Implemented; offline tests only |
| "Quality degrades with retries" hard stop | **Not implemented**: needs an owner-defined rubric |
| Boards (3, 7 or 9 frames) | Chosen by the owner; v2 spec awaiting approval; no code |
| UI, storage, auth, payments, deployment | None |

Details: [`docs/PROGRESS.md`](docs/PROGRESS.md) (what was run and what it showed),
[`docs/DECISIONS.md`](docs/DECISIONS.md) (where R1 was ambiguous and what the code does),
[`docs/TRACEABILITY.md`](docs/TRACEABILITY.md) (requirement and acceptance status).

## Setup

Requires Node 22 or newer.

```bash
npm ci
npm run verify   # typecheck, build, tests, lint, package import, offline runner smoke test
```

No API keys are needed for any of that.

## How a frame is produced

```
reference images + { identityDirection, environmentPreference?, moodTone? }
  -> intake: convert HEIC to JPEG; validate image bytes and the three permitted fields;
     drop anything else
  -> normalize: silently strip disallowed framing, actions, objects, roles, commands
  -> canonical prompt (verbatim R1 Section 4) + labeled variables
  -> generation loop, at most 3 calls
       -> analyze candidate against the references -> QA gate (8 discard rules)
       -> fail: discard, update counters, check hard stops
       -> pass: deliver, or apply one permitted refinement (lighting / environment tone /
          minor framing) to that image, at most 2 refinements per run; if no refinement
          passes, deliver the QA-passing image (V2-01)
  -> exit: one QA-passing frame, or a silent stop
```

Hard stops end the run before any further model call: likeness fails twice, or the same
violation repeats (anywhere in the run). A hard stop during a refinement still delivers the
QA-passing image it was editing (V2-01). Every outcome other than a delivered frame looks the
same to a user (`toPublicOutcome`).

## Source layout

| File | Role |
|------|------|
| `src/engine.ts` | Run controller, model interfaces, event ledger |
| `src/intake.ts`, `src/images.ts`, `src/heic.ts` | Input and image contracts; HEIC conversion |
| `src/normalize.ts`, `src/semanticNormalizer.ts` | Clean Intent (deterministic floor plus optional LLM) |
| `src/promptBuilder.ts` | Canonical prompt constant and variable serialization |
| `src/qaGate.ts` | Discard rules, violation codes, analysis validation |
| `src/refinement.ts` | Permitted refinement categories and system-owned edit text |
| `src/delivery.ts` | Public, silent outcome |
| `src/nanoBananaModel.ts` | Gemini generate and refine adapter |
| `src/openAIAnalysisModel.ts`, `src/openAISemanticNormalizer.ts` | OpenAI analyzer and normalizer adapters |
| `src/runner.ts`, `src/dev/` | Local runner and offline mock models |

## Using the engine

```typescript
import {
  NanoBananaImageGenerationModel,
  OpenAIImageAnalysisModel,
  VisionFramesEngine,
  toPublicOutcome,
} from 'vision-frames-v1';

const engine = new VisionFramesEngine(
  new NanoBananaImageGenerationModel({ apiKey: process.env.GEMINI_API_KEY }),
  new OpenAIImageAnalysisModel({ apiKey: process.env.OPENAI_API_KEY }),
  [{ bytes: photoBuffer }] // 1-4 reference images (PNG, JPEG, WebP, HEIC); format is read from the bytes
);

const result = await engine.execute({
  identityDirection: 'calm, grounded',
  environmentPreference: 'a quiet city street at dusk',
  moodTone: 'steady',
});

const outcome = toPublicOutcome(result); // { status: 'delivered', image } or { status: 'ended' }
// result.exitReason, result.violations and result.events are internal diagnostics only.
```

## Local runner

```bash
npm run build

# Offline, no keys (scenario: pass | refine | stop)
npm run frame -- --mock --scenario refine --identity "calm, grounded" --out out/mock

# Live provider calls (paid). Needs GEMINI_API_KEY and OPENAI_API_KEY; see .env.example.
npm run frame -- --live --ref me-1.jpg --ref me-2.jpg --identity "calm, grounded" --out out/live-1
```

The runner writes `frame.<ext>` when a frame is delivered and `run.json` with counts, events,
per-call timings, served model ids, and token usage. `run.json` never contains user text,
prompts, or image bytes. One live run makes at most 3 generation calls, 2 refinement calls, one
analysis call per candidate, and (with `--semantic`) one normalization call.

## Version freeze

Vision Frames v1 is frozen: one PDF is law, the canonical prompt is final, and any rule change
requires Vision Frames v2. Implementation clarifications that do not change rules are recorded
in `docs/DECISIONS.md`.

## License

UNLICENSED
