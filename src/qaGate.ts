/**
 * Vision Frames v1 - QA Gate
 * Single source of truth: spec/VisionFrames_v1.pdf Section 6 and System Flow step 5
 *
 * Pass/fail using PDF discard rules.
 * Auto-discard on any violation.
 * Never "fix" face/body/pose/action.
 *
 * Analysis arrives from a model at runtime, so it is validated before the gate runs.
 * Missing, mistyped, extra, or unparseable fields never count as a pass.
 */

import { REFINEMENT_TYPES, RefinementType } from './refinement';

export interface ImageAnalysis {
  isSeated: boolean;
  hasObjects: boolean;
  hasMultiplePeople: boolean;
  hasActionWorkOrGesture: boolean;
  likenessIssue: boolean;
  isOverStylized: boolean;
  hasWealthSignaling: boolean;
  isCloseUpOrExtremeAngle: boolean;
}

/**
 * Stable machine codes for each discard rule. Counters and hard stops key on these,
 * never on human-readable wording.
 */
export type ViolationCode =
  | 'seated'
  | 'objects_or_props'
  | 'multiple_people'
  | 'action_work_or_gesture'
  | 'likeness_drift'
  | 'over_stylized'
  | 'wealth_or_status'
  | 'close_up_or_extreme_angle';

/**
 * Analysis field to violation code. Violations are reported in this order.
 */
export const ANALYSIS_FIELD_CODES: ReadonlyArray<readonly [keyof ImageAnalysis, ViolationCode]> = [
  ['isSeated', 'seated'],
  ['hasObjects', 'objects_or_props'],
  ['hasMultiplePeople', 'multiple_people'],
  ['hasActionWorkOrGesture', 'action_work_or_gesture'],
  ['likenessIssue', 'likeness_drift'],
  ['isOverStylized', 'over_stylized'],
  ['hasWealthSignaling', 'wealth_or_status'],
  ['isCloseUpOrExtremeAngle', 'close_up_or_extreme_angle'],
];

export const ANALYSIS_FIELDS: ReadonlyArray<keyof ImageAnalysis> = ANALYSIS_FIELD_CODES.map(
  ([field]) => field
);

/**
 * Internal diagnostic wording (PDF Section 6). Never shown to the user.
 */
export const VIOLATION_LABELS: Record<ViolationCode, string> = {
  seated: 'Subject is seated',
  objects_or_props: 'Objects or props appear',
  multiple_people: 'Multiple people appear',
  action_work_or_gesture: 'Action, work, or gesture detected',
  likeness_drift: 'Likeness drifts or feels AI/stock',
  over_stylized: 'Over-stylized or surreal output',
  wealth_or_status: 'Explicit wealth or status signaling',
  close_up_or_extreme_angle: 'Close-ups or extreme angles',
};

export type Validation<T> = { valid: true; value: T } | { valid: false; reason: string };

/**
 * Validate that an unknown value is exactly an ImageAnalysis: a plain object with all
 * eight fields present as booleans and nothing else.
 */
export function validateAnalysis(raw: unknown): Validation<ImageAnalysis> {
  if (!isPlainObject(raw)) {
    return { valid: false, reason: 'analysis is not an object' };
  }
  for (const key of Object.keys(raw)) {
    if (!(ANALYSIS_FIELDS as readonly string[]).includes(key)) {
      return { valid: false, reason: `unexpected analysis field: ${key}` };
    }
  }
  for (const field of ANALYSIS_FIELDS) {
    if (typeof raw[field] !== 'boolean') {
      return { valid: false, reason: `analysis field ${field} is missing or not a boolean` };
    }
  }
  return { valid: true, value: raw as unknown as ImageAnalysis };
}

/**
 * What the analyzer reports for one candidate: the eight discard findings, plus the
 * single permitted refinement it considers eligible (or null for none).
 */
export interface AnalysisReport {
  findings: ImageAnalysis;
  refinement: RefinementType | null;
}

export function validateAnalysisReport(raw: unknown): Validation<AnalysisReport> {
  if (!isPlainObject(raw)) {
    return { valid: false, reason: 'report is not an object' };
  }
  const keys = Object.keys(raw);
  if (keys.length !== 2 || !('findings' in raw) || !('refinement' in raw)) {
    return { valid: false, reason: 'report must contain exactly findings and refinement' };
  }
  const findings = validateAnalysis(raw.findings);
  if (!findings.valid) {
    return findings;
  }
  const refinement = raw.refinement;
  if (refinement !== null && !(REFINEMENT_TYPES as readonly unknown[]).includes(refinement)) {
    return { valid: false, reason: 'refinement is not a permitted category or null' };
  }
  return {
    valid: true,
    value: { findings: findings.value, refinement: refinement as RefinementType | null },
  };
}

export interface QAResult {
  /** True only for a valid analysis with zero violations */
  passed: boolean;
  /** False when the analysis could not be validated; such a result never passes */
  valid: boolean;
  violations: ViolationCode[];
  invalidReason?: string;
}

/**
 * QA Gate - checks image against discard rules from PDF Section 6
 *
 * Auto-discard if any:
 * - Subject is seated
 * - Objects or props appear
 * - Multiple people appear
 * - Action, work, or gesture (System Flow step 5)
 * - Likeness drifts or feels "AI/stock"
 * - Over-stylized or surreal output
 * - Explicit wealth or status signaling
 * - Close-ups or extreme angles
 */
export function checkQAGate(raw: unknown): QAResult {
  const validation = validateAnalysis(raw);
  if (!validation.valid) {
    return { passed: false, valid: false, violations: [], invalidReason: validation.reason };
  }

  const analysis = validation.value;
  const violations = ANALYSIS_FIELD_CODES.filter(([field]) => analysis[field]).map(
    ([, code]) => code
  );

  return {
    passed: violations.length === 0,
    valid: true,
    violations,
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
