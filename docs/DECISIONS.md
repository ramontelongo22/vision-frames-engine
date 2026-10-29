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

All made by Rob (owner) on 2026-10-29 by choosing an option on a decision card in the project
thread, after each card set out the conflicting sources and a recommendation.

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

### Answers to open questions
| Question | Owner's choice | What follows |
|----------|----------------|--------------|
| O-01 single frame or board | A board made of frames | A v2 board spec is drafted for owner approval before any board code. The engine keeps producing one frame per run |
| Board size | Tiers of 3, 7 and 9 frames | Prices set after a live test measures the real cost per frame (D15) |
| Board rules | Every frame follows all v1 rules | No rule changes for boards; frames differ only in setting and mood |
| Board variety | Customer lists a few places | Up to one place per frame; blanks filled from an owner-approved settings list; every entry is normalized like `environmentPreference` |
| Board failures | Deliver passed frames, refund the rest | No extra attempts beyond each frame's own caps; partial refund or credit for missing frames |
| Board downloads | Each frame plus a board image | Individual image files plus one compiled board image laid out as a grid |
| O-02 quality rubric | Define it from live test images | After the live test the owner marks better and worse frames; a checklist is drafted from that for approval. AC-11 stays blocked until then |
| O-05 photos | Keep 1 to 4, add HEIC | HEIC is converted to JPEG on intake (P-09). Consent copy and likeness examples are still open |
| Audience | A few friendly testers soon | After the live test: a simple private upload and download page with a consent note. No payments yet |

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
  `maxRetries = 0`. Analysis calls are not capped by R1; there is one per candidate.
- **Tests:** `engine.test.ts` AC-07, AC-08; adapter tests.

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
- **Behavior:** 1 to 4 reference images (owner-confirmed, O-05), each at most 4 MB, PNG/JPEG/WebP
  sniffed from the bytes, at least 64 px per side. Raw intent fields at most 500 characters;
  clean values at most 200. Fields outside the three-field contract are dropped silently; wrong
  types are rejected.
- **HEIC (owner-approved, O-05):** a reference whose bytes are HEVC-coded HEIF (`src/heic.ts`)
  is decoded and re-encoded as JPEG before the checks above: input at most 20 MB and 50 M
  pixels, output longest side at most 2048 px, quality 90. Re-encoding drops all metadata,
  including EXIF location. Only the first top-level image in the file is used. A declared MIME
  type must be `image/heic` or `image/heif`. A file that cannot be decoded ends the run as
  `invalid_references` before any model call.
- **Dependency note:** decoding uses `heic-decode` 2.1.0 (ISC) over `libheif-js` 1.23.5
  (LGPL-3.0, libheif and libde265 compiled to WebAssembly); encoding uses `jpeg-js` 0.4.4
  (BSD-3-Clause). LGPL obligations and HEVC patent licensing for a commercial service have not
  been reviewed.
- **Measured (this container, Node 22):** a synthetic 12 MP (4032 x 3024) HEIC converted in
  about 3.4 s, with process memory around 340 MB. Tested only with libheif-encoded fixtures, not
  with files from an iPhone (which use tiled grid images and rotation).
- **Why these numbers:** none come from R1. Four is the lower of the documented character
  reference limits (Nano Banana 2.1: 4, Pro: 5). 2048 px matches the analyzer's high-detail
  input size.
- **Tests:** `engine.test.ts` AC-05, intake; `images.test.ts`; `heic.test.ts`.

### P-10 Providers and models (D12), checked 2026-10-28
- **Generator:** `@google/genai` 2.31.0, `models.generateContent`, default model
  `gemini-3-pro-image`. The baseline's `gemini-3-pro-image-preview` was deprecated 2026-05-28
  and shut down 2026-06-25 (Gemini API changelog); `gemini-3-pro-image` is its GA successor.
  `gemini-nano-banana-2.1` (GA 2026-10-06) is the docs' recommended general model and can be set
  with `VF_GEMINI_IMAGE_MODEL`. Google's docs now lead with the Interactions API and title the
  generateContent pages "Legacy", but no deprecation or shutdown of generateContent is announced.
- **Analyzer and normalizer:** `openai` 7.45.1 Responses API with strict JSON Schema output,
  default model `gpt-6-astra` (the docs' recommended default). Override with
  `VF_OPENAI_ANALYSIS_MODEL` / `VF_OPENAI_NORMALIZER_MODEL`.
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
  outcomes, status signals, and the R1 §2 disallowed framings. The optional LLM step
  (`OpenAISemanticNormalizer`) runs first when enabled; its output must be exactly the three
  fields and still passes through the deterministic filter. If the LLM step fails transiently,
  the deterministic filter alone is used; a fatal failure ends the run before any image call.
- **Role nouns:** "leader", "creator", "builder" and similar are removed (D14, conservative).

### P-13 Spec path (D17)
- **Behavior:** the literal `spec:/` directory was renamed to `spec/`. The PDF bytes are
  unchanged; `promptBuilder.test.ts` checks the hash.

## Open owner decisions

| ID | Question | Conflicting sources | Recommendation | Blocks |
|----|----------|---------------------|----------------|--------|
| O-01 (D01) | Strict single-frame v1, or a separately versioned multi-frame board product? | R1 p.1 "not a vision board"; later user request for about 7-10 images compiled into a board (C2, Jan 4-5) | **Decided 2026-10-29: a board made of frames** (see Owner decisions). Open: owner approval of the v2 board spec that turns these answers into a design. | Checkout, bundles, board assembly, UI scope |
| O-02 (D06) | What does "quality degrades with retries" mean in practice? | R1 §7 requires the stop but gives no metric, threshold, or judge; an invented score was removed in C1 | **Approach decided 2026-10-29:** define it from owner-marked live test images. The rubric itself is still open. | AC-11; any claim of full R1 compliance |
| O-03 (D04) | When a cosmetic refinement fails, may the earlier QA-passing base be delivered? | R1 System Flow 6 "fall back to generation loop"; System Flow 7 "A frame passes QA → delivered" | **Decided 2026-10-29: yes** (V2-01). | Nothing |
| O-04 (D11) | What should a user see when a run ends for technical or payment reasons? | R1 §7 "System stops silently"; C3 suggested "No frame generated"; paid orders are unspecified | Keep policy stops silent. Give technical and payment failures a neutral, non-coaching state and a defined refund or retry policy. | Public UI, payments |
| O-05 (D13) | Upload policy and likeness bar | R1 requires references; C2 suggests 3-4 photos and tolerates some variation | **Partly decided 2026-10-29:** 1 to 4 photos, HEIC accepted. Open: consent copy and a reviewed set of "same person / drifted" examples. | Public upload; AC-18 |
| O-06 (AC-17) | Authorize a bounded live smoke test | Handoff §15: no paid calls until inputs and a budget are set | One or a few runs of `npm run frame -- --live` with consented reference photos; each run is capped at 3 generations, 2 refinements, and one analysis per candidate. | Verifying real generation, refinement, and analysis |
