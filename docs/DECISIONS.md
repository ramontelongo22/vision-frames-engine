# Vision Frames v1: decision log

The frozen spec is `spec/VisionFrames_v1.pdf` (R1, "Vision Frames v1 - Rules & Flow", SHA-256
`15d5124ce2bf03dd429c99e97f47c52ab7fab91fab0a61275d2dfcfddf1577c4`). R1 wins over everything in
this file. Handoff IDs (D01-D17, F01-F15, AC-01-AC-20, B00-B16) refer to "Vision Frames —
Evidence-based Agent Handoff", 28 Oct 2026.

Three kinds of entries:

- **Owner decisions (V2-xx, and dated answers to O-xx).** Choices the owner made. A V2-xx entry
  changes an R1 rule and is the recorded Vision Frames v2 decision that change requires.
- **Provisional engineering decisions (P-xx).** Places where R1 is silent or ambiguous and the
  code needed one concrete behavior. Each is the most conservative reading available, is
  covered by tests, and can be changed without touching R1. None of them is an approved
  product change. The owner can overturn any of them.
- **Open owner decisions (O-xx).** Product questions the engine cannot settle. Nothing here has
  been decided on the owner's behalf.

## Owner decisions

All made by Rob (owner) on 2026-10-29 and 2026-10-30 by choosing an option on a decision card
in the project thread, after each card set out the conflicting sources and a recommendation.

### V2-01 A QA-passing frame is never thrown away because its refinement failed
- **Rule change:** R1 System Flow 6 says a failed refinement is discarded and the run either
  refines again or falls back to the generation loop. R1 §7 says a hard stop ends the run
  silently. Now, once a generation has passed QA, the run always ends by delivering a frame:
  the refined image if a refinement passes, otherwise that QA-passing base. This covers a
  refinement that fails QA, a refinement or its analysis that fails at the provider (fatal or
  transient), and a refinement that trips a hard stop (likeness failing twice, or a repeated
  violation). The hard stop still ends all further attempts. Cancellation still ends the run
  with nothing. Hard stops during generations are unchanged: the run ends with nothing.
- **Unchanged:** every discard rule, both caps, and the canonical prompt. A failed refinement
  is still discarded and never delivered or reused as a base.
- **Answers:** O-03 ("Deliver the passed image") and the follow-up card on hard stops ("Yes,
  deliver the passed image").
- **Code and tests:** `src/engine.ts` `refinementPhase`, `RunState.applyQA`, `stopIfFatal`;
  event `refinement_abandoned` records why. `engine.test.ts` AC-08, AC-09, AC-10, AC-12 and
  "O-03 a failed refinement delivers the QA-passing base".

### V2-02 Boards of 3, 7 or 9 frames, each made by one v1 run
- **Rule change:** R1 p.1 says "This is not a vision board", and v1 delivers one frame per
  run. v2 adds a board: 3, 7 or 9 frames ordered together. Each frame is one full,
  independent v1 engine run with its own 3 generations and 2 refinements, the shared
  reference photos, identity direction and mood, and that frame's place as its environment
  preference. The board never adds attempts to a frame, hard stops count within a frame only,
  and V2-01 applies to each frame.
- **Spec:** the Claude Doc "Vision Frames v2: boards"
  (https://claude.ai/artifact/N7J3zZRTN39MbkCAMDUazd), approved by Rob on 2026-10-30 with the
  card option "Approve, I'll mark settings later". His answers to its open questions are in
  the table below.
- **What a board does:** the customer may type up to one place per frame. Each typed place is
  filtered by its frame's run exactly like `environmentPreference`; one that filters down to
  nothing counts as a blank. Blanks are filled from the owner's settings list with no setting
  used twice; typed places may repeat. Board order is typed places in order, then filled
  ones. A frame that ends with no image is left off and refunded at an equal share of the
  board price. The board stops starting new frames only on a fatal provider failure or
  cancellation, and frames never started are refunded. Two or more delivered frames are
  composed into one board image with no text on it; one delivered frame comes alone; none
  delivered ends exactly like a single frame that stops. Frames are 16:9 landscape.
- **Unchanged for every frame:** the canonical prompt, the three Clean Intent fields, the
  eight discard rules, both caps, hard stops, silent stops, and language filtering.
- **Still open:** the owner's Keep, Drop or Reword marks on the settings list (the code uses
  `BOARD_SETTINGS_DRAFT` until then); how many frames run at once (3 until the live test);
  prices (after the live test); the private tester page.
- **Code and tests:** `src/board.ts` (`VisionFramesBoard`), `src/boardPlaces.ts`,
  `src/boardImage.ts`, `src/raster.ts`, `toPublicBoardOutcome` in `src/delivery.ts`,
  `DEFAULT_GEMINI_ASPECT_RATIO` in `src/nanoBananaModel.ts`, runner `--board` and `--place`.
  `board.test.ts`, `boardPlaces.test.ts`, `boardImage.test.ts`, `raster.test.ts`. Engineering
  choices the spec left open are P-14 and P-15.

### V2-03 The AI language cleanup step is on by default
- **Decision:** Rob chose "On by default, gpt-6-luna" on 2026-10-30, after the model and code
  audit (https://claude.ai/artifact/BaBZTB8f99kmAQk1gwokN6) showed that the deterministic filter
  only knows English word lists: "Quiero ser rico y exitoso, sentado en un Lamborghini" came out as
  "Quiero ser rico y exitoso, sentado en un", and spaced or misspelled words ("w e a l t h y",
  "r1ch") passed unchanged.
- **Not an R1 rule change:** R1 System Flow 2 is "Normalize & Filter (LLM)"; running without the
  LLM step was the departure. The deterministic filter still runs on the LLM's output (P-12).
- **Behavior:** the live runner enables `OpenAISemanticNormalizer` unless `--no-semantic` is given.
  Its default model is `gpt-6-luna` (`DEFAULT_OPENAI_NORMALIZER_MODEL`), separate from the QA
  model. One call per frame (P-15). Mock mode never makes the call. Any future production wiring
  must pass the normalizer to the engine the same way.
- **Code and tests:** `src/openAISemanticNormalizer.ts`, `src/runner.ts`;
  `openAIAnalysisModel.test.ts` (normalizer default).

### Answers to open questions
| Question | Owner's choice | What follows |
|----------|----------------|--------------|
| O-01 single frame or board | A board made of frames | v2 board spec approved 2026-10-30 (V2-02). The engine still makes one frame per run; a board runs one engine run per frame |
| Board size | Tiers of 3, 7 and 9 frames | Prices set after a live test measures the real cost per frame (D15) |
| Board rules | Every frame follows all v1 rules | No rule changes for boards; frames differ only in setting and mood |
| Board variety | Customer lists a few places | Up to one place per frame; blanks filled from an owner-approved settings list; every entry is normalized like `environmentPreference` |
| Board failures | Deliver passed frames, refund the rest | No extra attempts beyond each frame's own caps; partial refund or credit for missing frames |
| Board downloads | Each frame plus a board image | Individual image files plus one compiled board image laid out as a grid |
| O-02 quality rubric | Define it from live test images | After the live test the owner marks better and worse frames; a checklist is drafted from that for approval. AC-11 stays blocked until then |
| O-05 photos | Keep 1 to 4, add HEIC | HEIC is converted to JPEG on intake (P-09). Consent copy and likeness examples are still open |
| Audience | A few friendly testers soon | After the live test: a simple private upload and download page with a consent note. No payments yet |
| Frame shape (2026-10-30) | 16:9 landscape | Gemini requests default to 16:9 (`DEFAULT_GEMINI_ASPECT_RATIO`), for single frames too; board cells are 16:9 |
| Refund per missing frame (2026-10-30) | An equal share of the board price | Board records count refunded frames; `run.json` notes the share due. No money moves in the tester phase |
| Board image with one frame (2026-10-30) | No, just the frame | One delivered frame comes alone, with no board image |
| Same place twice (2026-10-30) | Yes, allow repeats | Typed places may repeat; fill-in settings never do |
| v2 board spec (2026-10-30) | Approve, I'll mark settings later | Recorded as V2-02 and built with the draft settings list, tested with mock models only |
| AI language cleanup (2026-10-30) | On by default, gpt-6-luna | Recorded as V2-03 |

## Provisional engineering decisions

### P-01 Refinement only when eligible (D03)
- **Behavior:** after a candidate passes QA, the analyzer may name one permitted category
  (`lighting`, `environment_tone`, `minor_framing`) or `null`. `null` delivers the candidate
  directly with zero refinements. The analyzer can only choose from that closed list; the
  edit text itself is system-owned (`src/refinement.ts`).
- **Sources:** R1 System Flow 5 "If pass: proceed to refinement eligibility"; System Flow 7
  "A frame passes QA → delivered"; R1 §7 limits refinements to three categories.
- **Replaces:** baseline always spent a refinement with an empty description (F11).
- **Tests:** `engine.test.ts` AC-13.

### P-02 Failed refinement and base selection (D04)
- **Behavior:** the QA-passing base is kept separately and is the only image ever edited. A
  failed refinement is discarded and never used as the next base. After a failed refinement,
  refine again from the same base if refinement budget remains. When no refinement passes, the
  base is delivered (V2-01); the run never returns to the generation loop after a pass.
- **Sources:** R1 §6 "Never fix… If these fail → discard"; System Flow 6 "discard and either
  refine again (if remaining), or fall back to generation loop", changed by V2-01.
- **History:** until 2026-10-29 the code followed System Flow 6 literally and fell back to
  generation, which could end with nothing after a frame had passed.
- **Tests:** `engine.test.ts` AC-06, AC-08, O-03.

### P-03 Hard-stop scope (D05)
- **Behavior:** state is updated from the current QA result first, then hard stops are checked,
  before any further call.
  - "Likeness fails twice": the second likeness-drift finding anywhere in the run, from a
    generation or a refinement.
  - "Same violation repeats": the second occurrence of any violation code anywhere in the run,
    adjacent or not, across generations and refinements. A pass in between does not reset it.
  - When both trigger together the reason recorded is `likeness_failed_twice`.
  - A hard stop tripped by a refinement delivers the QA-passing base (V2-01).
- **Sources:** R1 §7; System Flow 7; handoff D05 recommends second occurrence.
- **Consequence:** generation exhaustion only happens when three generations fail with no code
  repeated. The two baseline tests that expected `generations_exhausted` after three seated
  results were inconsistent with R1 and were replaced (handoff §7.3).
- **Tests:** `engine.test.ts` AC-09, AC-10, AC-12.

### P-04 Attempt accounting (D07)
- **Behavior:** a generation or refinement is counted when the call is made, whatever happens
  next (provider error, refusal, no image, invalid bytes). The refinement budget is one counter
  for the whole run. Adapters never retry: Gemini `retryOptions.attempts = 1`, OpenAI
  `maxRetries = 0`. The Gemini SDK's automatic continuation, on by default since
  `@google/genai` 2.31, would resend a request (billed again) whenever a reply ends with finish
  reason `CONTINUATION`; the adapter sets `automaticContinuation: false` and treats such a reply
  as a failed attempt (2026-10-30). Analysis calls are not capped by R1; there is one per
  candidate.
- **Tests:** `engine.test.ts` AC-07, AC-08; adapter tests; `sdkClients.test.ts` runs the real
  SDK clients against a stubbed fetch and checks one request per attempt.

### P-05 Technical failure handling (D07, D11, F12)
- **Behavior:** adapters map failures to kinds (`src/errors.ts`).
  - Fatal, the run ends as `technical_failure` (or `cancelled`): `auth`, `quota`,
    `bad_request`, `cancelled`, `unknown`.
  - Transient, the attempt is discarded and the run continues within its caps: `rate_limit`,
    `timeout`, `network`, `server`, `refusal`, `no_image`, `invalid_response`.
  - Malformed, refused, or failed analysis discards the candidate. It is never a pass and never
    counts as a QA violation.
  - A fatal failure during a refinement or its analysis delivers the QA-passing base instead of
    `technical_failure` (V2-01); cancellation does not.
- **Tests:** `engine.test.ts` AC-04, AC-15; adapter classification tests.

### P-06 Public outcome is silent (D11)
- **Behavior:** `toPublicOutcome` returns either the delivered image (bytes, MIME, dimensions)
  or `{ status: 'ended' }`. Every non-success outcome, including technical failure, looks the
  same publicly. Reasons, violations, and events stay internal.
- **Owner question:** see O-04.
- **Tests:** `delivery.test.ts`.

### P-07 Prompt serialization (B06, RQ-05)
- **Behavior:** canonical text first, verbatim, then each allowed variable on its own labeled
  line (`Identity direction:`, `Environment preference:`, `Mood/tone:`), collapsed to one line
  and omitted when empty. Provider requests label image parts `Reference images of the user:`
  and, for edits, `Image to edit:`. Baseline prepended identity unlabeled and appended the
  others unlabeled; R1 permits the variables but does not specify serialization.
- **Tests:** `promptBuilder.test.ts`.

### P-08 Empty or missing identity (D02, D17)
- **Behavior:** a missing or non-string identity is rejected at intake (`invalid_input`). An
  identity that normalizes to nothing ends the run before generation (`empty_intent`). No
  default identity is invented. Empty optional fields are omitted, not null.
- **Sources:** R1 System Flow 1 "Identity direction (required)"; handoff §8.2 "fail closed if it
  cannot produce safe intent".

### P-09 Intake limits (D13)
- **Behavior:** 1 to 4 reference images (owner-confirmed, O-05), PNG/JPEG/WebP sniffed from the
  bytes (or HEIC, below). Raw intent fields at most 500 characters; clean values at most 200.
  Fields outside the three-field contract are dropped silently; wrong types are rejected.
- **Every reference is re-encoded (2026-10-30):** an upload is checked first (at most 20 MB, 64 to
  16384 px per side, at most 50 M pixels, declared MIME type matching the bytes), then decoded and
  written again as JPEG quality 90 with `sharp` (`src/photo.ts`): EXIF orientation applied,
  longest side at most 2048 px, transparency flattened onto white, and all metadata dropped
  (EXIF including GPS location and camera serials, XMP, IPTC, ICC). The result must pass the
  reference contract: at most 4 MB, 64 to 8192 px per side. Before this, only HEIC was
  re-encoded; JPEG, PNG and WebP went to both providers byte for byte, GPS included, and
  anything over 4 MB was rejected. A board re-encodes once and every frame reuses the result
  (re-encoding a JPEG again would lose quality).
- **HEIC (owner-approved, O-05):** a reference whose bytes are HEVC-coded HEIF (`src/heic.ts`)
  is decoded and re-encoded as JPEG before the checks above: input at most 20 MB and 50 M
  pixels, output longest side at most 2048 px, quality 90. Re-encoding drops all metadata,
  including EXIF location. Only the first top-level image in the file is used. A declared MIME
  type must be `image/heic` or `image/heif`. A file that cannot be decoded ends the run as
  `invalid_references` before any model call.
- **Dependency note:** HEIC decoding uses `heic-decode` 2.1.0 (ISC) over `libheif-js` 1.23.5
  (LGPL-3.0, libheif and libde265 compiled to WebAssembly); encoding uses `jpeg-js` 0.4.4
  (BSD-3-Clause). Other formats use `sharp` 0.35.5 (Apache-2.0) with its prebuilt libvips
  8.18.7 (LGPL-3.0), a native binary installed per platform; the prebuilt libvips does not decode
  HEVC, so HEIC keeps its own path. LGPL obligations and HEVC patent licensing for a commercial
  service have not been reviewed.
- **Measured (this container, Node 22):** a synthetic 12 MP (4032 x 3024) HEIC converted in
  about 3.4 s, with process memory around 340 MB. Tested only with libheif-encoded fixtures, not
  with files from an iPhone (which use tiled grid images and rotation).
- **Why these numbers:** none come from R1. Four is the lower of the documented character
  reference limits (Nano Banana 2.1: 4, Pro: 5). 2048 px keeps faces detailed while keeping
  requests small; the GPT-6 image sizing table could not be read on 2026-10-30, so whether the
  analyzer downsizes further is unverified.
- **Tests:** `engine.test.ts` AC-05, intake; `images.test.ts`; `heic.test.ts`; `photo.test.ts`
  (orientation, metadata removal, large photos, WebP, transparency, damaged files);
  `board.test.ts` (one re-encode per board).

### P-10 Providers and models (D12), checked 2026-10-28, re-checked 2026-10-30
- **2026-10-30 audit** (https://claude.ai/artifact/BaBZTB8f99kmAQk1gwokN6): every default model
  is still live with no deprecation notice. `@google/genai` moved to 2.32.0. Gemini requests ask
  for `responseModalities: ['IMAGE']` only (was `TEXT` and `IMAGE`), as Google's current
  examples do, so no output text is paid for; to confirm in the live test. The normalizer now
  defaults to `gpt-6-luna` (V2-03). Candidates for the live test, not yet defaults:
  `gemini-nano-banana-2.1` ($0.034 per 1K image against $0.134 for Pro) and `gpt-6.1-terra` for QA
  (OpenAI's visual-reasoning model, $1 / $5 per 1M tokens against $10 / $50 for `gpt-6-astra`).
  Google's free tier may use inputs for training and human review, so real photos need a paid
  project; `store: false` does not change that.
- **Generator:** `@google/genai` 2.32.0, `models.generateContent`, default model
  `gemini-3-pro-image`. The baseline's `gemini-3-pro-image-preview` was deprecated 2026-05-28
  and shut down 2026-06-25 (Gemini API changelog); `gemini-3-pro-image` is its GA successor.
  `gemini-nano-banana-2.1` (GA 2026-10-06) is the docs' recommended general model and can be set
  with `VF_GEMINI_IMAGE_MODEL`. Google's docs now lead with the Interactions API and title the
  generateContent pages "Legacy", but no deprecation or shutdown of generateContent is announced.
- **Analyzer and normalizer:** `openai` 7.45.1 Responses API with strict JSON Schema output.
  Analyzer default `gpt-6-astra` (the docs' recommended default); normalizer default
  `gpt-6-luna` (V2-03). Override with `VF_OPENAI_ANALYSIS_MODEL` / `VF_OPENAI_NORMALIZER_MODEL`.
- **Data handling:** `store: false` on every request to both providers, so reference photos are
  not kept for later retrieval. This is a request setting, not a privacy guarantee; provider
  terms still apply.
- **Not verified:** account access, pricing, latency, refusal rates, and whether the analyzer
  model will compare a face against reference photos rather than refuse. Live testing is
  needed (O-06).

### P-11 Analyzer finding definitions (D08, D13)
- **Behavior:** `src/openAIAnalysisModel.ts` defines each of the eight findings for the model.
  When unsure, the model is told to answer true. "Objects or props" means anything the subject
  holds or handles, or a focal prop; ordinary architecture and background surroundings do not
  count. "Multiple people" includes background figures, reflections, and screens. Likeness
  drift includes changed facial structure or features, apparent age, skin tone, or build, and
  artificial or stock look; lighting, angle, and expression differences alone are not drift.
- **Status:** interpretation only. It needs owner review against labeled examples (AC-18).

### P-12 Normalization (B05, D14)
- **Behavior:** a deterministic filter (`src/normalize.ts`) always runs. It uses whole-word
  matching with inflections, drops whole clauses that read as instructions to the system, and
  removes user-supplied actions or poses (including "standing" and "walking": R1 §3 says users
  may not provide actions or poses; the canonical prompt already sets them), objects, roles and
  outcomes, status signals, and the R1 §2 disallowed framings. Its word lists are English only.
  The LLM step (`OpenAISemanticNormalizer`) runs first when enabled, which the live runner does
  by default (V2-03); its output must be exactly the three fields and still passes through the
  deterministic filter. If the LLM step fails transiently,
  the deterministic filter alone is used; a fatal failure ends the run before any image call.
- **Role nouns:** "leader", "creator", "builder" and similar are removed (D14, conservative).

### P-13 Spec path (D17)
- **Behavior:** the literal `spec:/` directory was renamed to `spec/`. The PDF bytes are
  unchanged; `promptBuilder.test.ts` checks the hash.

### P-14 Board details the v2 spec leaves open (V2-02)
- **Fatal failure:** "the provider fails fatally (a bad key, or quota used up)" is read as any
  frame run that meets one of the engine's fatal kinds (`auth`, `quota`, `bad_request`,
  `unknown`) or an internal error, including a frame that V2-01 still delivered from its base.
  Frames already running finish; no new frame starts. Rate limits, timeouts, network and
  server errors, refusals and missing images stay inside the frame's own run.
- **Cancellation:** frames already delivered stay delivered; frames running end with nothing
  (as in v1); frames not started are refunded.
- **Before any frame:** references are converted (HEIC) and checked once per board. Invalid
  references, or an identity that the deterministic filter empties when no semantic normalizer
  is configured, end the board before any model call; the record shows every frame refunded.
  Invalid board input (size, places, identity or mood types) is rejected with no order recorded.
- **Board image:** 960 x 540 cells, 24 px gutters, 48 px margin, warm off-white background,
  JPEG quality 90. A frame of another shape is scaled to cover its cell and cropped evenly,
  never stretched; transparency is flattened onto the background. Layouts by delivered count:
  2 and 3 in one row, 4 as 2 x 2, 5 as 3 over 2, 6 as 3 x 2, 7 as 4 over 3, 8 as 4 x 2, 9 as
  3 x 3. WebP frames are not decoded, so a board with one gets no board image (its frames are
  still delivered); the Gemini adapter has only returned PNG or JPEG in tests.
- **Frames at once:** 3 (spec open question 6, to confirm in the live test).
- **Settings fill:** a uniform random draw without repeats.

### P-15 Language cleanup runs once per frame, not once per board (V2-02)
- **Conflict:** the approved spec's cost section says "The optional language-cleanup step adds
  one call per board". Its other sections say each frame is one full, independent v1 run and
  each place is filtered exactly like today's environment field.
- **Behavior:** when the semantic normalizer is enabled (on by default in live runs since V2-03;
  `--no-semantic` turns it off), each frame's run calls it, so a board makes one call per frame
  (up to 9).
- **Trade-off:** up to 8 extra text-only calls per board, and the LLM may word the identity
  slightly differently in each frame. The alternative is one call for identity and mood per
  board plus deterministic filtering only for places. Revisit with live-test costs.

### P-16 Toolchain and CI, checked 2026-10-30
- **Node 24 or newer** (`engines`), tested in CI on Node 24 and 26. Node 26 is the current LTS
  and Node 22 has about six months of support left.
- **TypeScript 6.0.3, not 7.** TypeScript 7 ships no compiler API, and ts-jest 29.4.15 needs
  TypeScript below 7. TypeScript 6 deprecates `moduleResolution: node`, so the project uses
  `module: node20` with `moduleResolution: node16`, which resolve packages the way Node does.
  The compiled package is still CommonJS.
- **Dynamic import of `heic-decode`:** under `node20` the build keeps the native `import()`.
  ts-jest compiles tests as CommonJS instead, so in tests it becomes `require()`. ts-jest warns
  about this (code 151002), and `jest.config.js` silences only that code. To cover the built
  form, `smoke:mock` runs the compiled runner with a HEIC reference and fails unless the run
  succeeds.
- **ESLint 10 with a flat config** (`eslint.config.js`, `typescript-eslint` 8.72.1), same three
  rule settings as before. **Jest 30.5.2**, ts-jest 29.4.15.
- **CI** (`.github/workflows/ci.yml`): `npm ci`, `npm run verify` and `npm audit --omit=dev` on
  every pull request and every push to `main`. Mock providers only: no keys, no paid calls.
- **Known audit finding:** `npm audit` reports 6 low-severity findings, all from `deepmerge`
  inside Jest's config loader (GHSA-gcqx-w48m-w2h4). There is no fixed `deepmerge` release,
  and the only fix npm offers is a downgrade to Jest 25. It is a development dependency and
  never ships. `npm audit --omit=dev` is 0, and CI enforces that.

## Open owner decisions

| ID | Question | Conflicting sources | Recommendation | Blocks |
|----|----------|---------------------|----------------|--------|
| O-01 (D01) | Strict single-frame v1, or a separately versioned multi-frame board product? | R1 p.1 "not a vision board"; later user request for about 7-10 images compiled into a board (C2, Jan 4-5) | **Decided 2026-10-29: a board made of frames; spec approved 2026-10-30 (V2-02).** Open: the owner's marks on the settings list. | Final settings list; prices and checkout |
| O-02 (D06) | What does "quality degrades with retries" mean in practice? | R1 §7 requires the stop but gives no metric, threshold, or judge; an invented score was removed in C1 | **Approach decided 2026-10-29:** define it from owner-marked live test images. The rubric itself is still open. | AC-11; any claim of full R1 compliance |
| O-03 (D04) | When a cosmetic refinement fails, may the earlier QA-passing base be delivered? | R1 System Flow 6 "fall back to generation loop"; System Flow 7 "A frame passes QA → delivered" | **Decided 2026-10-29: yes** (V2-01). | Nothing |
| O-04 (D11) | What should a user see when a run ends for technical or payment reasons? | R1 §7 "System stops silently"; C3 suggested "No frame generated"; paid orders are unspecified | Keep policy stops silent. Give technical and payment failures a neutral, non-coaching state and a defined refund or retry policy. | Public UI, payments |
| O-05 (D13) | Upload policy and likeness bar | R1 requires references; C2 suggests 3-4 photos and tolerates some variation | **Partly decided 2026-10-29:** 1 to 4 photos, HEIC accepted. Open: consent copy and a reviewed set of "same person / drifted" examples. | Public upload; AC-18 |
| O-06 (AC-17) | Authorize a bounded live smoke test | Handoff §15: no paid calls until inputs and a budget are set | One or a few runs of `npm run frame -- --live` with consented reference photos; each run is capped at 3 generations, 2 refinements, and one analysis per candidate. | Verifying real generation, refinement, and analysis |
