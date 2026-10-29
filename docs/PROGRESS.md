# Vision Frames v1: progress log

Newest entry first. Each entry records the exact baseline, what changed, the commands run and
their actual output, what is still open, and the next action. Results are from the session
that wrote the entry; re-run them on any other checkout.

---

## 2026-10-29: owner decisions, refinement fallback (V2-01), HEIC references

**Branch:** `claude/engine-defects` (PR #1), from `2c8fa30`.
**Inputs:** Rob answered decision cards in the project thread on 2026-10-29. Each answer is
recorded in `docs/DECISIONS.md` under Owner decisions.

### Decisions recorded
- O-01: a board made of frames, in tiers of 3, 7 and 9 frames. Every frame keeps all v1 rules.
  The customer lists a few places. Frames that fail are refunded, with no extra attempts. The
  download is each frame plus a board image. A v2 board spec comes next for approval; no board
  code yet.
- O-03 plus a follow-up card: V2-01. A QA-passing frame is delivered when its refinements
  fail, including when a refinement trips a hard stop.
- O-02: the quality rubric will be defined from owner-marked live test images.
- O-05: keep 1 to 4 photos and accept HEIC.
- Audience: a few friendly testers soon.

### What changed
- `src/engine.ts`: `refinementPhase` delivers the base once no refinement passes, instead of
  falling back to generation. `RunState.applyQA` and `stopIfFatal` deliver the base when a hard
  stop or a fatal provider failure happens during a refinement. Cancellation still ends with
  nothing. The new event `refinement_abandoned` records the cause and replaces
  `refinement_fallback`. The engine now converts HEIC references before validating them.
- `src/heic.ts` (new): HEIC detection from `ftyp` brands (AVIF excluded), decode via
  `heic-decode`/`libheif-js` (WebAssembly, loaded on first use), area-average downscale to
  2048 px, and JPEG encode via `jpeg-js`. Never throws.
- `src/intake.ts`: `convertHeicReferences`. `src/config.ts`: `LIMITS.heicReference`.
  `src/types/heic-decode.d.ts`: typings. `src/index.ts` exports `convertHeicToJpeg` and `isHeic`.
- `package.json`: `heic-decode` 2.1.0 and `jpeg-js` 0.4.4 pinned exactly.
- Tests: refinement and hard-stop expectations in `engine.test.ts` updated to V2-01, plus a new
  "O-03" block (fatal and transient refinement failures, invalid analysis, cancellation,
  generation-only hard stop). New `tests/heic.test.ts` with two libheif-encoded fixtures in
  `tests/fixtures/` (made with pillow-heif 1.8.1 / libheif 1.23.6 / x265).
- Docs: `DECISIONS.md` (Owner decisions, V2-01, P-02, P-03, P-05, P-09, open table),
  `TRACEABILITY.md`, `README.md`, `CLAUDE.md` (board scope note).

### Results
| Check | Command | Result |
|-------|---------|--------|
| Full pipeline | `npm run verify` | exit 0 |
| Tests | (in verify) | 9 suites passed; 242 passed, 1 todo (AC-11, blocked) |
| Lint | `npm run lint` | 0 problems |
| Import | `npm run check:import` | `package import ok` |
| Mock runner | `npm run smoke:mock` | `public outcome: delivered`; `success, generations 1/3, refinements 1/2` |
| Coverage | `npx jest --coverage --runInBand` | statements 92.4%, branches 84.1%, functions 94.5%, lines 92.2%; `heic.ts` 100% |
| Runtime audit | `npm audit --omit=dev` | 0 vulnerabilities |
| HEIC timing | one-off Node script on the built package | 160x120: 169 ms. Synthetic 4032x3024 (10.6 MB, noise): 3.4 s, output 2048x1536 JPEG of 1.6 MB, process memory about 340 MB |

Under Jest the pure-JS downscale loop runs about 20 times slower than under plain Node
(5.1 s against 0.22 s for a 2600x1950 image), so the downscale fixture is a wide 2600x200
image to keep the suite fast. Production code runs under plain Node.

### Not verified
- No live provider call yet (O-06 still open).
- HEIC tested only with libheif-encoded files. Photos from an iPhone, which use tiled grid
  images and rotation boxes, have not been tried.
- LGPL-3.0 (libheif-js) obligations and HEVC patent licensing for a paid service have not
  been reviewed.

### Next action
1. Draft the v2 board spec from the answers above for owner approval.
2. Owner: O-06 live test (keys as environment secrets, `api.openai.com` allowed, 1 to 4
   consented photos, ideally including one HEIC straight from an iPhone).
3. After the live test: owner marks better and worse frames to define the O-02 rubric.

---

## 2026-10-28: engine defect repair, provider adapters, packaging

**Branch:** `claude/engine-defects`, from `main` at `5508e945b58e4f32743d741b4e8932491a14123d`
("initial commit", 2026-01-07; the only commit on `main`).
**Inputs:** R1 (`spec/VisionFrames_v1.pdf`, hash verified) and the evidence-based handoff PDF.
R2 (System Flow Diagram PDF) was not available in the upload or the repository, so R1 prose was
used for the flow, as the handoff directs.
**Runtime:** Node v22.22.0, npm 10.9.4.

### 1. Baseline reproduced before any change

Fresh clone, `npm install --ignore-scripts` (no lockfile was committed), then:

| Check | Command | Result |
|-------|---------|--------|
| Build | `npm run build` | passed |
| Tests | `npx jest --runInBand` | 38 tests: 33 passed, 5 failed (2 of 3 suites failed) |
| Lint | `npm run lint` | 1 error (`referenceImages` unused, `src/nanoBananaModel.ts:34`), 1 warning (`any`, line 94) |
| Import | `node -e "require('.')"` | failed: `dist/index.js` did not exist (build emitted `dist/src/`) |

The five failures matched the handoff: two exhaustion tests got `repeat_violations`, the
likeness test saw three generations, "showing" survived command filtering, and "luxury"
survived optional-field filtering.

Audit probes (same scenarios as the handoff's `audit/probe.cjs`, against the compiled baseline):

| Scenario | Baseline | After this change |
|----------|----------|-------------------|
| Empty analysis `{}` | passed QA | rejected as invalid, never a pass |
| likeness, likeness, pass | 3 generations, 3 analyses, stop | 2 generations, 2 analyses, `likeness_failed_twice` |
| seated, seated, seated | 3 generations, `repeat_violations` | 2 generations, `repeat_violations` |
| pass + 2 failing refinements, repeated across fallbacks | 6 refinement calls, reported 2 | 2 refinement calls, reported 2; generation 2 delivered once no refinement budget remained |
| clean, clean | forced 1 refinement | delivered with 0 refinements |

These are mocked control-flow results, not live model behavior.

### 2. Provider facts checked (2026-10-28)

- Gemini API changelog: `gemini-3-pro-image-preview`, the baseline's hardcoded model, was
  deprecated 2026-05-28 and shut down 2026-06-25. GA successor: `gemini-3-pro-image`.
- `@google/generative-ai` (baseline dependency) is the legacy SDK; replaced with
  `@google/genai` 2.31.0. That SDK retries only when `retryOptions` is set; the adapter pins one
  attempt.
- `openai` 7.45.1 (requires Node 22+) retries twice by default and stores Responses by default;
  the adapters set `maxRetries: 0` and `store: false`.
- Details and model ids: `docs/DECISIONS.md` P-10.

### 3. What changed

Engine and contracts:
- `src/engine.ts`: rewritten around one `RunState` per run. Calls are counted before they are
  made; QA results update state before the next step; hard stops end the run immediately; the
  terminal status is one-way and propagates out of refinement; one refinement budget for the
  whole run; refinements always edit the QA-passing base; refinement only when the analyzer
  names a permitted category; never throws; ordered internal event ledger with no user text or
  image bytes.
- `src/images.ts` (new): image contract. Bytes are checked for PNG/JPEG/WebP signatures and
  header dimensions; a declared MIME must match the bytes; no MIME is ever assumed.
- `src/intake.ts` (new): intent field and reference validation at the boundary.
- `src/qaGate.ts`: stable violation codes; strict validation of all eight booleans and of the
  analyzer report; anything malformed fails closed.
- `src/refinement.ts` (new): the three permitted categories and their system-owned edit text.
- `src/errors.ts` (new): provider failure kinds and the fatal set.
- `src/delivery.ts` (new): silent public projection.
- `src/promptBuilder.ts`: canonical text exported as a constant; labeled single-line variables
  after the unchanged core.
- `src/normalize.ts`: whole-word matching with inflections, instruction-clause dropping,
  Unicode and invisible-character handling, gap-aware cleanup, length cap; never throws.
- `src/semanticNormalizer.ts`, `src/openAISemanticNormalizer.ts` (new): optional LLM step for
  System Flow 2, validated and always followed by the deterministic floor.
- `src/config.ts`: R1 limits unchanged (3 generations, 2 refinements); provisional intake limits.
- `src/schema.ts`: `RawInput` and the field list moved here.

Provider adapters:
- `src/nanoBananaModel.ts`: rewritten. Generate sends the canonical prompt plus every reference
  as inline bytes; refine sends the edit prompt (which embeds the canonical text), the clean base
  image, and the references; strict response parsing (skips thought images, refusal and no-image
  detection, strict base64); error classification; `store: false`; no retries.
- `src/openAIAnalysisModel.ts` (new): reference-aware QA via the Responses API with strict JSON
  Schema output; refusal, incomplete, and unparseable responses fail closed.
- `src/providerMetadata.ts` (new): optional callback with served model, response id, status,
  token usage.

Tooling and docs:
- `src/runner.ts` (new) and `src/dev/`: local runner with an offline `--mock` mode and a
  `--live` mode that only starts with the explicit flag and both API keys.
- `tsconfig.json` (typecheck, no emit) and `tsconfig.build.json` (emits `dist/index.js`), so the
  package `main` resolves. `package.json`: SDKs pinned exactly, `engines.node >= 22`, `verify`,
  `check:import`, `smoke:mock`, `frame` scripts. `package-lock.json` committed. `.env.example`
  filled. `out/` ignored.
- `spec:/` renamed to `spec/` (bytes unchanged). Empty root `runner.ts`,
  `nanoBananaImageGenerationModel.ts`, `openAIImageAnalysisModel.ts` removed.
  `IMPLEMENTATION_SUMMARY.md`, `QUICK_REFERENCE.md`, `SETUP.md` removed (they claimed exit
  reasons and compliance that did not exist); `README.md` rewritten.
- Tests: `engine.test.ts` and `qaGate.test.ts` rewritten against R1 (the two baseline exhaustion
  tests that contradicted R1 were replaced, as the handoff instructs); `normalize.test.ts` kept
  and extended; new `promptBuilder`, `images`, `delivery`, `nanoBananaModel`,
  `openAIAnalysisModel` suites; `tests/helpers.ts`.

### 4. Results after the change

| Check | Command | Result |
|-------|---------|--------|
| Full pipeline | `npm run verify` | exit 0 |
| Typecheck | `npm run typecheck` | passed |
| Build | `npm run build` | passed, emits `dist/index.js` |
| Tests | `npm test -- --runInBand` | 8 suites passed; 219 passed, 1 todo (AC-11, blocked) |
| Lint | `npm run lint` | 0 errors, 0 warnings |
| Import | `npm run check:import` | `package import ok` |
| Mock runner | `npm run smoke:mock` | `public outcome: delivered`; `success, generations 1/3, refinements 1/2`; wrote `out/smoke/frame.png` and `run.json` |
| Coverage | `npx jest --coverage` | statements 91.5%, branches 83.3%, functions 94.1%, lines 91.3% (repo threshold 80%) |
| Dependency audit | `npm audit --omit=dev` | 0 vulnerabilities in runtime dependencies. Dev tooling (jest 29, typescript-eslint 6 via minimatch/deepmerge) reports 13 (7 low, 6 high); fixing needs major tooling upgrades, not done here |

### 5. Not verified, and why

- **No live provider call has been made.** Nothing here shows that Gemini accepts the request,
  returns an image of acceptable likeness, or performs a true edit, or that the OpenAI model
  will compare a face with reference photos instead of refusing. Live runs need the owner's
  approval (handoff §15), API keys, consented reference photos, and network access:
  `api.openai.com` is currently denied by this cloud environment's network policy
  (`generativelanguage.googleapis.com` is reachable).
- **Quality degradation stop (R1 §7) is not implemented.** It needs a rubric (O-02).
- **Analyzer definitions and normalization lists are interpretations** (P-11, P-12) that need
  owner-reviewed examples.
- No UI, storage, auth, or deployment exists or was attempted.

### 6. Next action

1. Owner: decide O-06 (live smoke test). Then add `GEMINI_API_KEY` and `OPENAI_API_KEY` as
   environment secrets, allow `api.openai.com` in the environment's network access, and provide
   1 to 4 consented reference photos.
2. Run `npm run build && npm run frame -- --live --ref <photo> ... --identity "..."` once, review
   the image by eye, and record `run.json` (model ids, timings, usage, exit reason) here.
3. Owner: O-02 quality rubric, then implement AC-11.
4. Owner: O-01 product envelope before any UI or checkout work.
