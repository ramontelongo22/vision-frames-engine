/**
 * Vision Frames v1 - State Machine Engine
 * Single source of truth: spec/VisionFrames_v1.pdf Section 7 and System Flow steps 0-7
 *
 * - Generation loop max 3 -> QA gate
 * - Refinement loop max 2 (lighting / env tone / minor framing still wide only) -> QA gate
 * - Exit: success or silent stop (attempts exhausted or hard stop triggered)
 *
 * One RunState per frame execution owns every counter and the terminal status. A call
 * is counted before it is made, every QA result is applied to state before the next
 * step is chosen, and once the run has ended no further model call can be scheduled.
 *
 * Transitions that R1 leaves open are implemented as recorded provisional decisions;
 * see docs/DECISIONS.md (P-01 .. P-06) for each one and the source it rests on.
 */

import { CONFIG, LIMITS } from './config';
import { FATAL_FAILURE_KINDS, ProviderFailureKind, failureKindOf } from './errors';
import { CandidateImage, ImagePayload, ReferenceImage, validateImageBytes } from './images';
import { convertHeicReferences, prepareReferences, validateRawInput } from './intake';
import { normalize } from './normalize';
import { buildCanonicalPrompt } from './promptBuilder';
import { ViolationCode, checkQAGate, validateAnalysisReport } from './qaGate';
import { RefinementType, buildRefinementPrompt } from './refinement';
import { CleanIntent, RawInput } from './schema';
import { SemanticNormalizer, validateSemanticOutput } from './semanticNormalizer';

export type { RawInput } from './schema';

export interface GenerationCall {
  /** Canonical prompt with allowed variables (promptBuilder.ts) */
  prompt: string;
  /** Validated reference images; every one must be sent to the provider */
  references: readonly ReferenceImage[];
  signal?: AbortSignal;
}

export interface RefinementCall {
  /** System-owned edit prompt (refinement.ts), which embeds the canonical prompt */
  prompt: string;
  refinement: RefinementType;
  /** The QA-passing image to edit. Never a discarded candidate. */
  baseImage: CandidateImage;
  references: readonly ReferenceImage[];
  signal?: AbortSignal;
}

/**
 * Image generation model. Adapters must not retry internally: every attempt the
 * provider might bill has to go through the engine's counters.
 */
export interface ImageGenerationModel {
  generate(call: GenerationCall): Promise<ImagePayload>;
  refine(call: RefinementCall): Promise<ImagePayload>;
}

export interface AnalysisCall {
  candidate: CandidateImage;
  /** The same validated references used for generation, for likeness comparison */
  references: readonly ReferenceImage[];
  signal?: AbortSignal;
}

/**
 * Image analysis model. Returns a raw report that the engine validates against
 * AnalysisReport (qaGate.ts); anything that does not validate is never a pass.
 */
export interface ImageAnalysisModel {
  analyze(call: AnalysisCall): Promise<unknown>;
}

export type ExitReason =
  | 'success'
  | 'generations_exhausted'
  | 'likeness_failed_twice'
  | 'repeat_violations'
  | 'invalid_input'
  | 'invalid_references'
  | 'empty_intent'
  | 'technical_failure'
  | 'cancelled';

export type ImageOperation = 'generation' | 'refinement';

/**
 * Ordered internal ledger of one run. Contains no user text and no image bytes.
 */
export type EngineEvent =
  | { type: 'intake_rejected'; reason: string }
  | { type: 'fields_dropped'; count: number }
  | { type: 'references_rejected'; reason: string }
  | { type: 'references_converted'; count: number }
  | { type: 'semantic_normalization_requested' }
  | { type: 'semantic_normalization_failed'; kind: ProviderFailureKind }
  | { type: 'normalized'; method: 'deterministic' | 'semantic' | 'deterministic_fallback' }
  | { type: 'generation_requested'; attempt: number }
  | { type: 'refinement_requested'; attempt: number; refinement: RefinementType; baseId: string }
  | { type: 'call_failed'; operation: ImageOperation; attempt: number; kind: ProviderFailureKind }
  | { type: 'candidate_rejected'; operation: ImageOperation; attempt: number; reason: string }
  | { type: 'candidate_received'; operation: ImageOperation; candidateId: string }
  | { type: 'analysis_requested'; candidateId: string }
  | { type: 'analysis_failed'; candidateId: string; kind: ProviderFailureKind }
  | { type: 'analysis_invalid'; candidateId: string; reason: string }
  | { type: 'qa_passed'; candidateId: string; refinement: RefinementType | null }
  | { type: 'qa_failed'; candidateId: string; violations: ViolationCode[] }
  | { type: 'refinement_skipped'; baseId: string; reason: 'budget_exhausted' }
  | {
      type: 'refinement_abandoned';
      baseId: string;
      cause: 'attempts_failed' | 'likeness_failed_twice' | 'repeat_violations' | ProviderFailureKind;
    }
  | { type: 'internal_error'; message: string }
  | { type: 'terminated'; reason: ExitReason };

export interface EngineResult {
  success: boolean;
  exitReason: ExitReason;
  /** Present only on success, and only ever a QA-passing image */
  finalImage?: CandidateImage;
  /** Generation calls actually made */
  generationAttempts: number;
  /** Refinement calls actually made, across the whole run */
  refinementAttempts: number;
  /** Violations for each validly analyzed candidate, in order (empty array = passed) */
  violations: ViolationCode[][];
  events: EngineEvent[];
}

export interface EngineOptions {
  /** Optional LLM normalization step (System Flow step 2) */
  semanticNormalizer?: SemanticNormalizer;
}

export interface ExecuteOptions {
  signal?: AbortSignal;
}

/**
 * Per-run state. Terminal transitions are one-way; counters only increase.
 */
class RunState {
  private status: 'running' | 'success' | 'stopped' = 'running';
  private exitReason: ExitReason | undefined;
  private finalImage: CandidateImage | undefined;
  private generationCallsUsed = 0;
  private refinementCallsUsed = 0;
  private likenessFailures = 0;
  private readonly violationCounts = new Map<ViolationCode, number>();
  private readonly violations: ViolationCode[][] = [];
  private readonly events: EngineEvent[] = [];

  get active(): boolean {
    return this.status === 'running';
  }

  canGenerate(): boolean {
    return this.active && this.generationCallsUsed < CONFIG.maxGenerations;
  }

  canRefine(): boolean {
    return this.active && this.refinementCallsUsed < CONFIG.maxRefinements;
  }

  beginGeneration(): number {
    if (!this.canGenerate()) {
      throw new Error('invariant: generation is not permitted in this state');
    }
    this.generationCallsUsed++;
    this.record({ type: 'generation_requested', attempt: this.generationCallsUsed });
    return this.generationCallsUsed;
  }

  beginRefinement(refinement: RefinementType, baseId: string): number {
    if (!this.canRefine()) {
      throw new Error('invariant: refinement is not permitted in this state');
    }
    this.refinementCallsUsed++;
    this.record({ type: 'refinement_requested', attempt: this.refinementCallsUsed, refinement, baseId });
    return this.refinementCallsUsed;
  }

  record(event: EngineEvent): void {
    this.events.push(event);
  }

  /**
   * Apply one valid QA result, then evaluate hard stops before anything else happens.
   *
   * - Likeness fails twice: second likeness failure anywhere in the run (P-03).
   * - Same violation repeats: second occurrence of any violation code anywhere in the
   *   run, across generations and refinements, adjacent or not (P-03).
   *
   * A hard stop ends the run. When the result is for a refinement of `passedBase`, that
   * QA-passing base is delivered instead of ending with nothing (V2-01).
   */
  applyQA(violations: ViolationCode[], passedBase?: CandidateImage): void {
    this.violations.push([...violations]);

    for (const code of violations) {
      this.violationCounts.set(code, (this.violationCounts.get(code) ?? 0) + 1);
    }
    if (violations.includes('likeness_drift')) {
      this.likenessFailures++;
    }

    let hardStop: 'likeness_failed_twice' | 'repeat_violations' | undefined;
    if (this.likenessFailures >= 2) {
      hardStop = 'likeness_failed_twice';
    } else if ([...this.violationCounts.values()].some((count) => count >= 2)) {
      hardStop = 'repeat_violations';
    }
    if (!hardStop) {
      return;
    }
    if (passedBase) {
      this.record({ type: 'refinement_abandoned', baseId: passedBase.id, cause: hardStop });
      this.succeed(passedBase);
    } else {
      this.stop(hardStop);
    }
  }

  succeed(image: CandidateImage): void {
    this.finish('success');
    this.finalImage = image;
  }

  stop(reason: Exclude<ExitReason, 'success'>): void {
    this.finish(reason);
  }

  private finish(reason: ExitReason): void {
    if (!this.active) {
      throw new Error('invariant: run has already ended');
    }
    this.status = reason === 'success' ? 'success' : 'stopped';
    this.exitReason = reason;
    this.record({ type: 'terminated', reason });
  }

  toResult(): EngineResult {
    const exitReason = this.exitReason ?? 'technical_failure';
    const success = this.status === 'success' && this.finalImage !== undefined;
    return {
      success,
      exitReason,
      ...(success ? { finalImage: this.finalImage } : {}),
      generationAttempts: this.generationCallsUsed,
      refinementAttempts: this.refinementCallsUsed,
      violations: this.violations.map((v) => [...v]),
      events: [...this.events],
    };
  }
}

/**
 * Vision Frames v1 State Machine Engine
 */
export class VisionFramesEngine {
  constructor(
    private readonly generationModel: ImageGenerationModel,
    private readonly analysisModel: ImageAnalysisModel,
    private readonly referenceImages: readonly unknown[],
    private readonly options: EngineOptions = {}
  ) {}

  /**
   * Execute the complete Vision Frames v1 pipeline for one frame.
   * Never throws: every outcome, including internal errors, is an EngineResult.
   */
  async execute(rawInput: unknown, options: ExecuteOptions = {}): Promise<EngineResult> {
    const run = new RunState();
    try {
      await this.runPipeline(rawInput, run, options.signal);
      if (run.active) {
        run.stop('generations_exhausted');
      }
    } catch (error) {
      run.record({ type: 'internal_error', message: error instanceof Error ? error.message : String(error) });
      if (run.active) {
        run.stop('technical_failure');
      }
    }
    return run.toResult();
  }

  private async runPipeline(rawInput: unknown, run: RunState, signal?: AbortSignal): Promise<void> {
    // Step 1: Intake
    const intake = validateRawInput(rawInput);
    if (!intake.ok) {
      run.record({ type: 'intake_rejected', reason: intake.reason });
      run.stop('invalid_input');
      return;
    }
    if (intake.droppedFieldCount > 0) {
      run.record({ type: 'fields_dropped', count: intake.droppedFieldCount });
    }

    const conversion = await convertHeicReferences(this.referenceImages);
    if (!conversion.ok) {
      run.record({ type: 'references_rejected', reason: conversion.reason });
      run.stop('invalid_references');
      return;
    }
    if (conversion.convertedCount > 0) {
      run.record({ type: 'references_converted', count: conversion.convertedCount });
    }

    const referenceIntake = prepareReferences(conversion.references);
    if (!referenceIntake.ok) {
      run.record({ type: 'references_rejected', reason: referenceIntake.reason });
      run.stop('invalid_references');
      return;
    }
    const references = referenceIntake.references;

    if (this.stopIfCancelled(run, signal)) {
      return;
    }

    // Step 2: Normalize & Filter
    const cleanIntent = await this.normalizeIntent(intake.input, run, signal);
    if (!run.active) {
      return;
    }
    if (!cleanIntent.identityDirection) {
      run.stop('empty_intent');
      return;
    }

    // Step 3: Compose Canonical Prompt
    const prompt = buildCanonicalPrompt(cleanIntent);

    // Step 4: Generate Attempt Loop (max 3 generations)
    while (run.canGenerate()) {
      if (this.stopIfCancelled(run, signal)) {
        return;
      }
      const attempt = run.beginGeneration();
      const candidate = await this.invokeImageCall(run, signal, 'generation', attempt, undefined, () =>
        this.generationModel.generate({ prompt, references, signal })
      );
      if (!run.active) {
        return;
      }
      if (!candidate) {
        continue;
      }

      // Step 5: Automated QA Gate
      const review = await this.review(candidate, references, run, signal);
      if (!run.active) {
        return;
      }
      if (!review) {
        continue;
      }

      // Step 6: Refinement eligibility and loop. Always ends the run (O-03).
      await this.refinementPhase(candidate, review.refinement, prompt, references, run, signal);
      return;
    }
  }

  /**
   * Step 6. The QA-passing base is kept separately and is the only image ever edited;
   * a failed refinement is discarded, never reused as a base (P-01, P-02). When no
   * refinement passes, the base is delivered instead of generating again (O-03), and a
   * hard stop during refinement also delivers it (V2-01). Cancellation ends the run with
   * nothing.
   */
  private async refinementPhase(
    base: CandidateImage,
    refinement: RefinementType | null,
    canonicalPrompt: string,
    references: readonly ReferenceImage[],
    run: RunState,
    signal?: AbortSignal
  ): Promise<void> {
    if (refinement === null) {
      run.succeed(base);
      return;
    }
    if (!run.canRefine()) {
      run.record({ type: 'refinement_skipped', baseId: base.id, reason: 'budget_exhausted' });
      run.succeed(base);
      return;
    }

    const prompt = buildRefinementPrompt(refinement, canonicalPrompt);

    while (run.canRefine()) {
      if (this.stopIfCancelled(run, signal)) {
        return;
      }
      const attempt = run.beginRefinement(refinement, base.id);
      const refined = await this.invokeImageCall(run, signal, 'refinement', attempt, base, () =>
        this.generationModel.refine({ prompt, refinement, baseImage: base, references, signal })
      );
      if (!run.active) {
        return;
      }
      if (!refined) {
        continue;
      }

      const review = await this.review(refined, references, run, signal, base);
      if (!run.active) {
        return;
      }
      if (review) {
        run.succeed(refined);
        return;
      }
    }

    run.record({ type: 'refinement_abandoned', baseId: base.id, cause: 'attempts_failed' });
    run.succeed(base);
  }

  /**
   * Make one counted image call and validate what comes back. Returns null when the
   * attempt produced nothing usable; the run ends if the failure is fatal. `base` is
   * the QA-passing image being refined, if any.
   */
  private async invokeImageCall(
    run: RunState,
    signal: AbortSignal | undefined,
    operation: ImageOperation,
    attempt: number,
    base: CandidateImage | undefined,
    call: () => Promise<ImagePayload>
  ): Promise<CandidateImage | null> {
    let payload: ImagePayload;
    try {
      payload = await call();
    } catch (error) {
      const kind = signal?.aborted ? 'cancelled' : failureKindOf(error);
      run.record({ type: 'call_failed', operation, attempt, kind });
      this.stopIfFatal(run, kind, base);
      return null;
    }

    if (this.stopIfCancelled(run, signal)) {
      return null;
    }

    const payloadRecord = (typeof payload === 'object' && payload !== null ? payload : {}) as Partial<ImagePayload>;
    const validation = validateImageBytes(payloadRecord.bytes, payloadRecord.mimeType, LIMITS.candidate);
    if (!validation.ok) {
      run.record({ type: 'candidate_rejected', operation, attempt, reason: validation.error });
      return null;
    }

    const candidate: CandidateImage = {
      ...validation.image,
      id: `${operation}-${attempt}`,
      origin: operation,
      ...(base ? { baseId: base.id } : {}),
    };
    run.record({ type: 'candidate_received', operation, candidateId: candidate.id });
    return candidate;
  }

  /**
   * Analyze one candidate against the references and apply the QA gate.
   * Returns the eligible refinement when the candidate passes, otherwise null.
   * `passedBase` is set when the candidate is a refinement of that image.
   */
  private async review(
    candidate: CandidateImage,
    references: readonly ReferenceImage[],
    run: RunState,
    signal?: AbortSignal,
    passedBase?: CandidateImage
  ): Promise<{ refinement: RefinementType | null } | null> {
    if (this.stopIfCancelled(run, signal)) {
      return null;
    }

    run.record({ type: 'analysis_requested', candidateId: candidate.id });
    let raw: unknown;
    try {
      raw = await this.analysisModel.analyze({ candidate, references, signal });
    } catch (error) {
      const kind = signal?.aborted ? 'cancelled' : failureKindOf(error);
      run.record({ type: 'analysis_failed', candidateId: candidate.id, kind });
      this.stopIfFatal(run, kind, passedBase);
      return null;
    }

    if (this.stopIfCancelled(run, signal)) {
      return null;
    }

    const report = validateAnalysisReport(raw);
    if (!report.valid) {
      run.record({ type: 'analysis_invalid', candidateId: candidate.id, reason: report.reason });
      return null;
    }

    const qa = checkQAGate(report.value.findings);
    if (qa.passed) {
      run.record({ type: 'qa_passed', candidateId: candidate.id, refinement: report.value.refinement });
      run.applyQA([]);
      return { refinement: report.value.refinement };
    }

    run.record({ type: 'qa_failed', candidateId: candidate.id, violations: qa.violations });
    run.applyQA(qa.violations, passedBase);
    return null;
  }

  private async normalizeIntent(input: RawInput, run: RunState, signal?: AbortSignal): Promise<CleanIntent> {
    const semantic = this.options.semanticNormalizer;
    if (!semantic) {
      run.record({ type: 'normalized', method: 'deterministic' });
      return normalize(input);
    }

    run.record({ type: 'semantic_normalization_requested' });
    try {
      const raw = await semantic.normalize(input, { signal });
      const validation = validateSemanticOutput(raw);
      if (validation.valid) {
        run.record({ type: 'normalized', method: 'semantic' });
        return normalize(validation.value);
      }
      run.record({ type: 'semantic_normalization_failed', kind: 'invalid_response' });
    } catch (error) {
      const kind = signal?.aborted ? 'cancelled' : failureKindOf(error);
      run.record({ type: 'semantic_normalization_failed', kind });
      if (this.stopIfFatal(run, kind)) {
        return { identityDirection: '' };
      }
    }

    run.record({ type: 'normalized', method: 'deterministic_fallback' });
    return normalize(input);
  }

  /**
   * End the run on a fatal failure. During a refinement the QA-passing base is delivered
   * instead (O-03); cancellation always ends the run with nothing.
   */
  private stopIfFatal(run: RunState, kind: ProviderFailureKind, passedBase?: CandidateImage): boolean {
    if (!run.active) {
      return true;
    }
    if (kind === 'cancelled') {
      run.stop('cancelled');
      return true;
    }
    if (FATAL_FAILURE_KINDS.has(kind)) {
      if (passedBase) {
        run.record({ type: 'refinement_abandoned', baseId: passedBase.id, cause: kind });
        run.succeed(passedBase);
      } else {
        run.stop('technical_failure');
      }
      return true;
    }
    return false;
  }

  private stopIfCancelled(run: RunState, signal?: AbortSignal): boolean {
    if (!run.active) {
      return true;
    }
    if (signal?.aborted) {
      run.stop('cancelled');
      return true;
    }
    return false;
  }
}
