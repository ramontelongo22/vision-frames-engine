/**
 * Vision Frames v1 - QA Gate
 * Single source of truth: /spec/VisionFrames_v1.pdf Section 6
 *
 * Pass/fail using PDF discard rules.
 * Auto-discard on any violation.
 * Never "fix" face/body/pose/action.
 */

export interface QAResult {
  passed: boolean;
  violations: string[];
}

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
 * QA Gate - checks image against discard rules from PDF Section 6
 *
 * Auto-discard if any:
 * - Subject is seated
 * - Objects or props appear
 * - Multiple people appear
 * - Likeness drifts or feels "AI/stock"
 * - Over-stylized or surreal output
 * - Explicit wealth or status signaling
 * - Close-ups or extreme angles
 */
export function checkQAGate(analysis: ImageAnalysis): QAResult {
  const violations: string[] = [];

  if (analysis.isSeated) {
    violations.push('Subject is seated');
  }

  if (analysis.hasObjects) {
    violations.push('Objects or props appear');
  }

  if (analysis.hasMultiplePeople) {
    violations.push('Multiple people appear');
  }

  if (analysis.hasActionWorkOrGesture) {
    violations.push('Action, work, or gesture detected');
  }

  if (analysis.likenessIssue) {
    violations.push('Likeness drifts or feels AI/stock');
  }

  if (analysis.isOverStylized) {
    violations.push('Over-stylized or surreal output');
  }

  if (analysis.hasWealthSignaling) {
    violations.push('Explicit wealth or status signaling');
  }

  if (analysis.isCloseUpOrExtremeAngle) {
    violations.push('Close-ups or extreme angles');
  }

  return {
    passed: violations.length === 0,
    violations,
  };
}
