# Vision Frames v1 - Setup Guide

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

This will install all required TypeScript, Jest, and ESLint packages.

### 2. Build the Project

```bash
npm run build
```

Compiles TypeScript to JavaScript in the `dist/` directory.

### 3. Run Tests

```bash
npm test
```

Expected output: All tests should pass, validating:
- Input normalization (silently strips disallowed content)
- QA gate rules (auto-discard violations)
- Engine state machine (counters, limits, exit conditions)

### 4. Run Tests with Coverage

```bash
npm run test:coverage
```

Coverage thresholds are set to 80% (branches, functions, lines, statements).

## Project Structure

```
Vision-Frames v1/
├── spec/
│   └── VisionFrames_v1.pdf         # Single source of truth
├── src/
│   ├── schema.ts                   # Clean Intent (3 fields)
│   ├── normalize.ts                # Silent input filtering
│   ├── promptBuilder.ts            # Canonical prompt (verbatim)
│   ├── qaGate.ts                   # Pass/fail validation
│   ├── config.ts                   # Hard-coded limits
│   ├── engine.ts                   # State machine
│   └── index.ts                    # Public exports
├── tests/
│   ├── normalize.test.ts           # Normalization tests
│   ├── qaGate.test.ts              # QA gate tests
│   └── engine.test.ts              # Engine tests
├── package.json
├── tsconfig.json
├── jest.config.js
├── .eslintrc.js
├── .gitignore
└── README.md
```

## Implementation Example

```typescript
import {
  VisionFramesEngine,
  ImageGenerationModel,
  ImageAnalysisModel,
  GeneratedImage,
  ImageAnalysis,
  RawInput,
} from './src';

// 1. Implement your image generation model
class MyImageGenerator implements ImageGenerationModel {
  async generate(prompt: string, refs: unknown[]): Promise<GeneratedImage> {
    // Call your image generation API (e.g., DALL-E, Midjourney, etc.)
    // Return generated image
    return {
      id: 'generated-image-id',
      data: { /* image data */ },
    };
  }

  async refine(image: GeneratedImage, refinement: RefinementRequest): Promise<GeneratedImage> {
    // Apply refinement (lighting/environment tone/minor framing only)
    return {
      id: `${image.id}-refined`,
      data: { /* refined image data */ },
    };
  }
}

// 2. Implement your image analysis model
class MyImageAnalyzer implements ImageAnalysisModel {
  async analyze(image: GeneratedImage): Promise<ImageAnalysis> {
    // Analyze image for violations
    // Return analysis result
    return {
      isSeated: false,
      hasObjects: false,
      hasMultiplePeople: false,
      likenessIssue: false,
      isOverStylized: false,
      hasWealthSignaling: false,
      isCloseUpOrExtremeAngle: false,
    };
  }
}

// 3. Create engine and execute
const engine = new VisionFramesEngine(
  new MyImageGenerator(),
  new MyImageAnalyzer(),
  referenceImages // User's reference images
);

const userInput: RawInput = {
  identityDirection: 'calm and grounded presence',
  environmentPreference: 'urban night setting',
  moodTone: 'composed',
};

const result = await engine.execute(userInput);

if (result.success) {
  console.log('✓ Image generated successfully');
  console.log('Final image:', result.finalImage);
  console.log('Generations used:', result.generationAttempts);
  console.log('Refinements used:', result.refinementAttempts);
} else {
  console.log('✗ Generation failed');
  console.log('Exit reason:', result.exitReason);
  console.log('Violations:', result.violations);
  // System stops silently - no user notification
}
```

## Key Implementation Notes

### Input Normalization
- Silently strips ALL disallowed content
- Never notifies user
- Removes: manifest, wealthy, rich, successful, hustle, grind, fantasy, etc.
- Removes: actions, poses, objects, props, jobs, roles, outcomes, commands

### Canonical Prompt
- Fixed template from PDF Section 4
- Only 3 variable insertions allowed
- No modifications to canonical wording
- System-owned and final for v1

### QA Gate
- Pass/fail only (no partial success)
- Auto-discard on ANY violation
- Never attempts to "fix" face/body/pose/action
- Violations: seated, objects, multiple people, likeness drift, over-stylized, wealth signaling, close-ups/extreme angles

### State Machine
- Max 3 generations
- Max 2 refinements (lighting/env tone/minor framing only)
- Hard stops: likeness fails twice, repeat violations, quality degrading
- Exit: success OR silent stop (no explanations, no warnings)

### Version Freeze
- PDF is single source of truth
- No overrides, no exceptions
- Changes require Vision Frames v2

## Testing Strategy

All tests validate exact PDF specification compliance:

1. **normalize.test.ts**: Validates silent stripping of all disallowed content
2. **qaGate.test.ts**: Validates pass/fail rules with no partial success
3. **engine.test.ts**: Validates counters, limits, exit conditions, and hard stops

## Troubleshooting

### TypeScript Errors
Make sure you've run `npm install` to install all dev dependencies including `@types/jest`.

### Test Failures
Tests are designed to match the PDF specification exactly. Any test failure indicates non-compliance with Vision Frames v1 rules.

### Linting Issues
Run `npm run lint` to check for code style issues.

## License

UNLICENSED - Single source of truth: `/spec/VisionFrames_v1.pdf`
