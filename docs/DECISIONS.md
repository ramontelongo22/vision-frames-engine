# Vision Frames v1: decision log

The frozen spec is `spec/VisionFrames_v1.pdf` (R1, "Vision Frames v1 - Rules & Flow", SHA-256
`15d5124ce2bf03dd429c99e97f47c52ab7fab91fab0a61275d2dfcfddf1577c4`). R1 wins over everything in
this file. Handoff IDs (D01-D17, F01-F15, AC-01-AC-20, B00-B16) refer to "Vision Frames —
Evidence-based Agent Handoff", 28 Oct 2026.

Two kinds of entries:

- **Provisional engineering decisions (P-xx).** Places where R1 is silent or ambiguous and the
  code needed one concrete behavior. Each is the most conservative reading available, is
  covered by tests, and can be changed without touching R1. None of them is an approved
  product change. The owner can overturn any of them.
- **Open owner decisions (O-xx).** Product questions the engine cannot settle. Nothing here has
  been decided on the owner's behalf.

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
  failed refinement is discarded and never used as the next base. After a failed refinement:
  refine again from the same base if refinement budget remains, otherwise fall back to the
  generation loop if generation budget remains (R1 System Flow 6, read literally). If both are
  used up the run ends silently, even though the earlier base had passed QA. When a later
  generation passes and wants a refinement but none is left, it is delivered as is.
- **Sources:** R1 §6 "Never fix… If these fail → discard"; System Flow 6 "discard and either
  refine again (if remaining), or fall back to generation loop".
- **Owner question:** see O-03.
- **Tests:** `engine.test.ts` AC-06, AC-08.

### P-03 Hard-stop scope (D05)
- **Behavior:** state is updated from the current QA result first, then hard stops are checked,
  before any further call.
  - "Likeness fails twice": the second likeness-drift finding anywhere in the run, from a
    generation or a refinement.
  - "Same violation repeats": the second occurrence of any violation code anywhere in the run,
    adjacent or not, across generations and refinements. A pass in between does not reset it.
  - When both trigger together the reason recorded is `likeness_failed_twice`.
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
- **Behavior:** 1 to 4 reference images, each at most 4 MB, PNG/JPEG/WebP sniffed from the bytes,
  at least 64 px per side. Raw intent fields at most 500 characters; clean values at most 200.
  Fields outside the three-field contract are dropped silently; wrong types are rejected.
- **Why these numbers:** none come from R1. Four is the lower of the documented character
  reference limits (Nano Banana 2.1: 4, Pro: 5). HEIC is not accepted, which matters for
  iPhone uploads.
- **Tests:** `engine.test.ts` AC-05, intake; `images.test.ts`.

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
| O-01 (D01) | Strict single-frame v1, or a separately versioned multi-frame board product? | R1 p.1 "not a vision board"; later user request for about 7-10 images compiled into a board (C2, Jan 4-5) | Keep the engine single-frame. Decide the commercial envelope (frame count, whether each frame keeps every v1 rule, pricing) as a recorded v2 change before any checkout, bundle, collage, or UI work. | Checkout, bundles, board assembly, UI scope |
| O-02 (D06) | What does "quality degrades with retries" mean in practice? | R1 §7 requires the stop but gives no metric, threshold, or judge; an invented score was removed in C1 | Define a small labeled rubric with examples, then a temporal rule such as "a later candidate rated worse than an earlier one on the rubric". | AC-11; any claim of full R1 compliance |
| O-03 (D04) | When a cosmetic refinement fails, may the earlier QA-passing base be delivered? | R1 System Flow 6 "fall back to generation loop"; System Flow 7 "A frame passes QA → delivered" | Today's code follows step 6 literally (P-02). Delivering the passing base would save spend and still meet every discard rule. | Nothing; a one-branch change either way |
| O-04 (D11) | What should a user see when a run ends for technical or payment reasons? | R1 §7 "System stops silently"; C3 suggested "No frame generated"; paid orders are unspecified | Keep policy stops silent. Give technical and payment failures a neutral, non-coaching state and a defined refund or retry policy. | Public UI, payments |
| O-05 (D13) | Upload policy and likeness bar | R1 requires references; C2 suggests 3-4 photos and tolerates some variation | Confirm count, size, formats (HEIC?), consent copy, and a reviewed set of "same person / drifted" examples. | Public upload; AC-18 |
| O-06 (AC-17) | Authorize a bounded live smoke test | Handoff §15: no paid calls until inputs and a budget are set | One or a few runs of `npm run frame -- --live` with consented reference photos; each run is capped at 3 generations, 2 refinements, and one analysis per candidate. | Verifying real generation, refinement, and analysis |
