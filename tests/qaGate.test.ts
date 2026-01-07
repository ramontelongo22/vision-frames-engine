/**
 * Vision Frames v1 - QA Gate Tests
 */

import { checkQAGate, ImageAnalysis } from '../src/qaGate';

describe('checkQAGate', () => {
  const cleanAnalysis: ImageAnalysis = {
    isSeated: false,
    hasObjects: false,
    hasMultiplePeople: false,
    hasActionWorkOrGesture: false,
    likenessIssue: false,
    isOverStylized: false,
    hasWealthSignaling: false,
    isCloseUpOrExtremeAngle: false,
  };

  it('should pass clean image with no violations', () => {
    const result = checkQAGate(cleanAnalysis);

    expect(result.passed).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it('should fail if subject is seated', () => {
    const result = checkQAGate({
      ...cleanAnalysis,
      isSeated: true,
    });

    expect(result.passed).toBe(false);
    expect(result.violations).toContain('Subject is seated');
  });

  it('should fail if objects appear', () => {
    const result = checkQAGate({
      ...cleanAnalysis,
      hasObjects: true,
    });

    expect(result.passed).toBe(false);
    expect(result.violations).toContain('Objects or props appear');
  });

  it('should fail if multiple people appear', () => {
    const result = checkQAGate({
      ...cleanAnalysis,
      hasMultiplePeople: true,
    });

    expect(result.passed).toBe(false);
    expect(result.violations).toContain('Multiple people appear');
  });

  it('should fail if action, work, or gesture detected', () => {
    const result = checkQAGate({
      ...cleanAnalysis,
      hasActionWorkOrGesture: true,
    });

    expect(result.passed).toBe(false);
    expect(result.violations).toContain('Action, work, or gesture detected');
  });

  it('should fail on likeness issues', () => {
    const result = checkQAGate({
      ...cleanAnalysis,
      likenessIssue: true,
    });

    expect(result.passed).toBe(false);
    expect(result.violations).toContain('Likeness drifts or feels AI/stock');
  });

  it('should fail if over-stylized', () => {
    const result = checkQAGate({
      ...cleanAnalysis,
      isOverStylized: true,
    });

    expect(result.passed).toBe(false);
    expect(result.violations).toContain('Over-stylized or surreal output');
  });

  it('should fail on wealth signaling', () => {
    const result = checkQAGate({
      ...cleanAnalysis,
      hasWealthSignaling: true,
    });

    expect(result.passed).toBe(false);
    expect(result.violations).toContain('Explicit wealth or status signaling');
  });

  it('should fail on close-ups or extreme angles', () => {
    const result = checkQAGate({
      ...cleanAnalysis,
      isCloseUpOrExtremeAngle: true,
    });

    expect(result.passed).toBe(false);
    expect(result.violations).toContain('Close-ups or extreme angles');
  });

  it('should accumulate multiple violations', () => {
    const result = checkQAGate({
      isSeated: true,
      hasObjects: true,
      hasMultiplePeople: true,
      hasActionWorkOrGesture: false,
      likenessIssue: false,
      isOverStylized: false,
      hasWealthSignaling: false,
      isCloseUpOrExtremeAngle: false,
    });

    expect(result.passed).toBe(false);
    expect(result.violations).toHaveLength(3);
    expect(result.violations).toContain('Subject is seated');
    expect(result.violations).toContain('Objects or props appear');
    expect(result.violations).toContain('Multiple people appear');
  });

  it('should fail on all violations at once', () => {
    const allViolations: ImageAnalysis = {
      isSeated: true,
      hasObjects: true,
      hasMultiplePeople: true,
      hasActionWorkOrGesture: true,
      likenessIssue: true,
      isOverStylized: true,
      hasWealthSignaling: true,
      isCloseUpOrExtremeAngle: true,
    };

    const result = checkQAGate(allViolations);

    expect(result.passed).toBe(false);
    expect(result.violations).toHaveLength(8);
  });
});
