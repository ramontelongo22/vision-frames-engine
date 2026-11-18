# Vision Frames engine: notes for coding agents

- Spec: `spec/VisionFrames_v1.pdf` (R1, frozen). It outranks code, docs, tests, and chat history.
  Never change the canonical prompt (`CANONICAL_PROMPT_V1`), the three Clean Intent fields, the
  discard rules, or the 3-generation / 2-refinement caps without a recorded Vision Frames v2 decision.
- Ambiguities and how the code resolves them: `docs/DECISIONS.md`. Open owner decisions there
  (O-xx) are not yours to settle; ask the owner with the conflicting sources and a recommendation.
- Status and evidence: `docs/PROGRESS.md` (add a dated entry for every work session: baseline
  commit, files changed, commands and actual results, gaps, next action) and `docs/TRACEABILITY.md`.
- Proof before claims: run `npm run verify` and quote its real output. Mocked tests prove control
  flow only. Never describe live generation, likeness, or quality as working without a recorded
  live run reviewed by a person.
- No paid API calls (`npm run frame -- --live`), deployments, or customer-facing messages without
  the owner's explicit approval.
- Out of scope unless the owner approves it: video, checkout, libraries/CRUD apps, wardrobe or pose
  controls, extra intake fields. Boards are in scope: the owner approved the v2 board spec on
  2026-10-30 (`docs/DECISIONS.md` V2-02). Board intake is size, identity, mood and up to one place
  per frame, nothing more. The fill-in settings list stays a draft until the owner marks it.
- Do not invent a quality metric for the "quality degrades" stop; it stays blocked until the owner
  defines a rubric.
