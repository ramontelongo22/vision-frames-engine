# Vision Frames v1: requirement and acceptance traceability

Status values: **PASS** (automated test passes in this repo), **PASS (mock)** (control flow or
request shape proven with mocks; says nothing about live model quality), **BLOCKED** (needs an
owner decision), **NOT VERIFIED** (needs a live or human check that has not happened).

Last updated 2026-10-30 on branch `claude/boards` (built on `claude/engine-defects`). See `docs/PROGRESS.md` for the
commands and output behind each PASS.

## Acceptance criteria (handoff §11)

| AC | What it requires | Status | Evidence |
|----|------------------|--------|----------|
| AC-01 | Canonical text matches R1; PDF hash matches; no provider rewrites the core | PASS | `promptBuilder.test.ts` "source integrity"; adapters send `call.prompt` unchanged (`nanoBananaModel.test.ts`) |
| AC-02 | Only permitted intent keys survive; references required and validated | PASS | `engine.test.ts` intake and AC-05 reference cases; `images.test.ts`; `heic.test.ts` (HEIC converted, O-05). Size limits are provisional (P-09) |
| AC-03 | Hidden action/prop/role/outcome/command requests neutralized; safe wording kept | PASS (deterministic floor) | `normalize.test.ts` AC-03 fixtures. LLM step request shape tested; live behavior NOT VERIFIED. Empty identity per P-08 |
| AC-04 | Each of eight violations fails; malformed, missing, refused analysis never passes | PASS | `qaGate.test.ts`; `engine.test.ts` AC-04 (13 malformed shapes); `openAIAnalysisModel.test.ts` parse failures |
| AC-05 | Generation request carries exact reference bytes; analyzer gets candidate plus references | PASS (mock) | `engine.test.ts` AC-05; `nanoBananaModel.test.ts` generate; `openAIAnalysisModel.test.ts` |
| AC-06 | Refinement sends the clean base, an allowed instruction, and the constraints; failed edits never reused | PASS (mock) | `engine.test.ts` AC-06 and O-03 (base delivered when no refinement passes, V2-01); `nanoBananaModel.test.ts` refine; `promptBuilder.test.ts` refinement prompts |
| AC-07 | Three distinct failures make exactly three generations | PASS | `engine.test.ts` AC-07 |
| AC-08 | Refinement calls never exceed two; counts equal calls | PASS | `engine.test.ts` AC-08, including the audit's six-call scenario (now ends after two calls by delivering the base, V2-01) |
| AC-09 | No further work after the second likeness failure | PASS | `engine.test.ts` AC-09 (generation+generation, generation+refinement, refinement+refinement); a stop from a refinement delivers its base (V2-01) |
| AC-10 | Repeat stop at the second occurrence, adjacent or not, across operation types | PASS | `engine.test.ts` AC-10 (rule per P-03) |
| AC-11 | Quality degradation stop | BLOCKED (O-02) | `engine.test.ts` `it.todo`; not implemented, no metric invented |
| AC-12 | Terminal state cannot be reactivated; no final image on a stop | PASS | `engine.test.ts` AC-12 and `expectCleanTermination` in every engine test. Exception by V2-01: a stop during refinement delivers the QA-passing base |
| AC-13 | Pass with no eligible refinement is delivered directly; no empty edit | PASS | `engine.test.ts` AC-13 (rule per P-01) |
| AC-14 | Filtered content and QA reasons never shown | PASS (engine boundary) | `delivery.test.ts`. No UI exists to test |
| AC-15 | No-image, non-image MIME, malformed base64, refusal, auth, quota, rate limit, timeout, abort, cancellation | PASS (mock) | `engine.test.ts` AC-15 and cancellation; `nanoBananaModel.test.ts` and `openAIAnalysisModel.test.ts` classification |
| AC-16 | Clean install from lockfile; build, tests, lint pass; package import; mock runner artifact | PASS | `npm ci && npm run verify` (see PROGRESS.md) |
| AC-17 | Bounded live run proving generate, QA, success or stop, and a real edit | NOT VERIFIED (O-06) | Runner `--live` writes `run.json` with model ids, versions, timings, usage. Not run: needs approval, keys, consented photos, and network access to api.openai.com |
| AC-18 | Owner-reviewed quality evaluation set | NOT VERIFIED (O-02, O-05) | None yet |
| AC-19 | User flow (upload, progress, download, clean stop) | NOT STARTED | Board engine exists (V2-02); the private tester page comes after the live test |
| AC-20 | Release evidence | NOT MET | AC-11, AC-17, AC-18 open; O-01 to O-06 open |

## Locked requirements (handoff §4)

| RQ | Where it is enforced | Status |
|----|----------------------|--------|
| RQ-01 single still image, not a board | Engine delivers one frame per run | PASS for the engine. Changed for v2 by V2-02: a board is assembled from independent v1 frame runs |
| RQ-02 language framing | `normalize.ts` disallowed framing; canonical text kept verbatim (D10) | PASS (deterministic) |
| RQ-03 intake boundary | `intake.ts`, `prepareReferences` | PASS |
| RQ-04 silent semantic normalization | `normalize.ts`, `semanticNormalizer.ts`, `openAISemanticNormalizer.ts` | PASS (mock); live LLM NOT VERIFIED |
| RQ-05 immutable canonical prompt | `promptBuilder.ts` `CANONICAL_PROMPT_V1` | PASS |
| RQ-06 action and subject constraints | Canonical prompt; QA findings | PASS (gate logic); live detection NOT VERIFIED |
| RQ-07 composition and lighting | Canonical prompt; close-up finding; refinement categories | PASS (gate logic); live NOT VERIFIED |
| RQ-08 discard, never repair | QA gate; refinements edit only the clean base and forbid face/body/pose/action/identity changes | PASS |
| RQ-09 max 3 generations | `RunState.beginGeneration` | PASS |
| RQ-10 max 2 refinements, permitted categories only | `RunState.beginRefinement`; `REFINEMENT_TYPES` | PASS |
| RQ-11 hard stops | `RunState.applyQA` (likeness, repeat); a stop during refinement delivers the base (V2-01); quality stop BLOCKED | PARTIAL (O-02) |
| RQ-12 silent exit | `delivery.ts` | PASS at engine boundary; UI wording O-04 |
| RQ-13 claims and versioning | Normalizer removes status/outcome terms; this log records every clarification | PASS (deterministic) |

## v2 boards (V2-02)

| Requirement from the approved spec | Where it is enforced | Status | Evidence |
|------------------------------------|----------------------|--------|----------|
| Sizes 3, 7 and 9 only | `BOARD.sizes`, `isBoardSize`, board intake | PASS | `boardPlaces.test.ts` isBoardSize; `board.test.ts` board intake |
| Each frame is one full, independent v1 run with its own caps | `VisionFramesBoard` runs a new `VisionFramesEngine` per frame | PASS (mock) | `board.test.ts` "own 3 generations", "own 2 refinements" |
| Shared photos, identity and mood; the frame's place as its environment | `VisionFramesBoard.run` | PASS (mock) | `board.test.ts` "shared photos", "identity and mood into every frame prompt" |
| Hard stops count within a frame only; V2-01 per frame | Engine `RunState` per frame | PASS (mock) | `board.test.ts` "hard stops within a frame only", "keeps each passed frame" |
| Up to one place per frame, filtered like the environment field; a place filtered to nothing is a blank | `validatePlaces`, `planPlaces`; each frame's engine run filters its place | PASS | `boardPlaces.test.ts`; `board.test.ts` "filters down to nothing" |
| Blanks filled from the owner's list with no repeats; typed places may repeat; typed first | `planPlaces`, `assertUsableSettings` | PASS | `boardPlaces.test.ts` |
| Settings list approved by the owner | `BOARD_SETTINGS_DRAFT` | NOT VERIFIED | Draft list; owner marks pending |
| Missing frames left off and refunded at an equal share; no extra attempts | `BoardResult.refundedCount`; runner `refundDue` | PASS (mock) | `board.test.ts` "leaves a failed frame off" |
| Stops starting frames only on fatal provider failure or cancellation; not-started frames refunded | `hitFatalFailure`, worker pool halt (P-14) | PASS (mock) | `board.test.ts` early end |
| Up to 3 frames at once | `BOARD.concurrency` | PASS (mock); live limits NOT VERIFIED | `board.test.ts` frames running at once |
| Board image of delivered frames in a grid, no text; none for a single frame | `boardGeometry`, `composeBoard` | PASS | `boardImage.test.ts` pixel geometry; `board.test.ts` board order and single frame |
| 16:9 landscape frames | `DEFAULT_GEMINI_ASPECT_RATIO`; 16:9 cells | PASS (request shape); live output NOT VERIFIED | `nanoBananaModel.test.ts`; `boardImage.test.ts` |
| Silence: reasons never shown; nothing passes ends like a stopped frame | `toPublicBoardOutcome` | PASS (engine boundary) | `board.test.ts` public outcome cases; events carry no customer text |
| Cost per board measured | Runner `run.json` timings and usage | NOT VERIFIED (O-06) | No live run |

## Defect ledger (handoff §7.5)

| Defect | Status | Where |
|--------|--------|-------|
| F01 references not sent | Fixed | `nanoBananaModel.ts` `referenceParts` |
| F02 fake refinement | Fixed | `nanoBananaModel.ts` `refine` sends base image, edit prompt, canonical text, references |
| F03 late hard stop | Fixed | `RunState.applyQA` runs before the next step |
| F04 refinement budget reset | Fixed | One `refinementCallsUsed` counter per run |
| F05 refinement stop did not terminate | Fixed | Terminal status is shared and one-way |
| F06 malformed QA passed | Fixed | `validateAnalysis`, `validateAnalysisReport` |
| F07 no reference-aware analyzer | Fixed (mock-verified) | `openAIAnalysisModel.ts`; live likeness NOT VERIFIED |
| F08 quality degradation omitted | Open, BLOCKED | O-02 |
| F09 failed refinement reused | Fixed | `refinementPhase` always edits the clean base |
| F10 normalization insufficient | Improved | Deterministic floor plus optional LLM step |
| F11 forced refinement | Fixed | P-01 |
| F12 transport failures undefined | Fixed | `errors.ts`, P-05 |
| F13 package entry mismatch | Fixed | `tsconfig.build.json`; `npm run check:import` |
| F14 no lockfile, empty env template, legacy SDK | Fixed | `package-lock.json`, `.env.example`, `@google/genai` |
| F15 docs and evidence drift | Fixed | README rewritten; stale summary docs removed; this file |
