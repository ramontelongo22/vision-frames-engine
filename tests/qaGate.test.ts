/**
 * Vision Frames v1 - QA Gate Tests
 */

import { checkQAGate, ImageAnalysis, validateAnalysisReport, VIOLATION_LABELS } from '../src/qaGate';

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
    expect(result.valid).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  describe('AC-04 each discard rule fails independently', () => {
    const cases: Array<[keyof ImageAnalysis, string, string]> = [
      ['isSeated', 'seated', 'Subject is seated'],
      ['hasObjects', 'objects_or_props', 'Objects or props appear'],
      ['hasMultiplePeople', 'multiple_people', 'Multiple people appear'],
      ['hasActionWorkOrGesture', 'action_work_or_gesture', 'Action, work, or gesture detected'],
      ['likenessIssue', 'likeness_drift', 'Likeness drifts or feels AI/stock'],
      ['isOverStylized', 'over_stylized', 'Over-stylized or surreal output'],
      ['hasWealthSignaling', 'wealth_or_status', 'Explicit wealth or status signaling'],
      ['isCloseUpOrExtremeAngle', 'close_up_or_extreme_angle', 'Close-ups or extreme angles'],
    ];

    it.each(cases)('should fail when %s is true', (field, code, label) => {
      const result = checkQAGate({ ...cleanAnalysis, [field]: true });

      expect(result.passed).toBe(false);
      expect(result.valid).toBe(true);
      expect(result.violations).toEqual([code]);
      expect(VIOLATION_LABELS[result.violations[0]]).toBe(label);
    });
  });

  it('should accumulate multiple violations', () => {
    const result = checkQAGate({
      ...cleanAnalysis,
      isSeated: true,
      hasObjects: true,
      hasMultiplePeople: true,
    });

    expect(result.passed).toBe(false);
    expect(result.violations).toEqual(['seated', 'objects_or_props', 'multiple_people']);
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

  describe('AC-04 malformed analysis never passes', () => {
    const malformed: Array<[string, unknown]> = [
      ['empty object (audit probe)', {}],
      ['null', null],
      ['undefined', undefined],
      ['string', '{"isSeated":false}'],
      ['number', 0],
      ['array', [cleanAnalysis]],
      ['missing field', (({ likenessIssue: _omit, ...rest }) => rest)(cleanAnalysis)],
      ['null field', { ...cleanAnalysis, hasObjects: null }],
      ['string field', { ...cleanAnalysis, isSeated: 'false' }],
      ['numeric field', { ...cleanAnalysis, hasMultiplePeople: 0 }],
      ['unknown extra field', { ...cleanAnalysis, passed: true }],
      ['class instance', Object.assign(Object.create({ inherited: true }), cleanAnalysis)],
    ];

    it.each(malformed)('rejects %s', (_label, raw) => {
      const result = checkQAGate(raw);

      expect(result.passed).toBe(false);
      expect(result.valid).toBe(false);
      expect(result.invalidReason).toEqual(expect.any(String));
    });
  });
});

describe('validateAnalysisReport', () => {
  const findings: ImageAnalysis = {
    isSeated: false,
    hasObjects: false,
    hasMultiplePeople: false,
    hasActionWorkOrGesture: false,
    likenessIssue: false,
    isOverStylized: false,
    hasWealthSignaling: false,
    isCloseUpOrExtremeAngle: false,
  };

  it.each([null, 'lighting', 'environment_tone', 'minor_framing'])('accepts refinement %p', (refinement) => {
    const result = validateAnalysisReport({ findings, refinement });
    expect(result.valid).toBe(true);
  });

  it.each([
    ['face repair category', { findings, refinement: 'face' }],
    ['free-text refinement', { findings, refinement: 'make them look more confident' }],
    ['missing refinement', { findings }],
    ['missing findings', { refinement: null }],
    ['extra key', { findings, refinement: null, notes: 'x' }],
    ['malformed findings', { findings: {}, refinement: null }],
  ])('rejects %s', (_label, raw) => {
    expect(validateAnalysisReport(raw).valid).toBe(false);
  });
});
