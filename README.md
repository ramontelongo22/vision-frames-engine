# Vision Frames v1

Identity-first still image generation system implementing the Vision Frames v1 specification.

**Single source of truth:** `/spec/VisionFrames_v1.pdf`

## Overview

Vision Frames v1 generates identity-first still images depicting a future version of the user in a grounded moment of presence. This is not a vision board, cinematic reel, fantasy, or productivity simulation.

## Architecture

The codebase implements an exact state machine with strict constraints:

### Core Modules

- **[src/schema.ts](src/schema.ts)** - Clean Intent schema (3 fields only)
  - `identityDirection` (required string)
  - `environmentPreference` (optional string - broad only)
  - `moodTone` (optional string)

- **[src/normalize.ts](src/normalize.ts)** - Input normalization
  - Silently strips disallowed framing words
  - Removes actions/poses, objects/props, jobs/roles/outcomes, commands/instructions
  - Keeps only identity direction (non-visual, non-actional), broad environment preference, and mood/tone
  - Never notifies the user

- **[src/promptBuilder.ts](src/promptBuilder.ts)** - Canonical prompt builder
  - Returns the Canonical Internal Prompt verbatim from PDF Section 4
  - Inserts only the 3 allowed variables without changing canonical wording

- **[src/qaGate.ts](src/qaGate.ts)** - Quality assurance gate
  - Pass/fail using PDF discard rules
  - Auto-discard on any violation
  - Never "fix" face/body/pose/action

- **[src/config.ts](src/config.ts)** - Hard-coded limits
  - `maxGenerations = 3`
  - `maxRefinements = 2`

- **[src/engine.ts](src/engine.ts)** - State machine engine
  - Generation loop (max 3) → QA gate
  - Refinement loop (max 2: lighting/env tone/minor framing still wide only) → QA gate
  - Exit: success or silent stop (attempts exhausted or hard stop triggered)
  - No UI, stub model calls as interfaces

### Tests

- **[tests/normalize.test.ts](tests/normalize.test.ts)** - Unit tests for normalization logic
- **[tests/qaGate.test.ts](tests/qaGate.test.ts)** - Unit tests for QA gate rules
- **[tests/engine.test.ts](tests/engine.test.ts)** - Unit tests for engine counters and exit conditions

## Installation

```bash
npm install
```

## Build

```bash
npm run build
```

Compiles TypeScript to JavaScript in the `dist/` directory.

## Run Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage
```

## Lint

```bash
npm run lint
```

## Usage

```typescript
import { VisionFramesEngine } from './src/engine';
import { RawInput } from './src/engine';

// Implement your image generation and analysis models
class MyGenerationModel implements ImageGenerationModel {
  // ... implementation
}

class MyAnalysisModel implements ImageAnalysisModel {
  // ... implementation
}

// Create engine instance
const engine = new VisionFramesEngine(
  new MyGenerationModel(),
  new MyAnalysisModel(),
  referenceImages
);

// Execute with user input
const input: RawInput = {
  identityDirection: 'calm and grounded presence',
  environmentPreference: 'urban setting',
  moodTone: 'composed',
};

const result = await engine.execute(input);

if (result.success) {
  console.log('Success!', result.finalImage);
} else {
  console.log('Exit reason:', result.exitReason);
}
```

## Constraints & Rules

### Allowed Framing (locked)
- Future version
- Identity frame
- Arrival
- Presence
- Calm, grounded, composed

### Disallowed Framing
- Manifest/manifestation
- Simulation/roleplay
- Wealthy/rich/successful
- Hustle/grind
- Fantasy/dream life
- Glow-up/upgrade

### Allowed Actions
- Standing
- Walking (slow, mid-stride)
- Entering or exiting a space
- Still presence

### Auto-Discard Rules
Images are discarded immediately if any occur:
- Subject is seated
- Objects or props appear
- Multiple people appear
- Likeness drifts or feels "AI/stock"
- Over-stylized or surreal output
- Explicit wealth or status signaling
- Close-ups or extreme angles

### Hard Stop Conditions
System stops silently if:
- Likeness fails twice
- Same violation repeats
- Quality degrades with retries

## Exit Conditions

- **Success**: A frame passes QA → delivered
- **Silent Stop**: Attempts exhausted OR hard stop triggered
  - No explanations
  - No warnings
  - No "try again" coaching

## Version Freeze

Vision Frames v1 is frozen:
- One PDF = law
- Canonical prompt is final
- Any change requires Vision Frames v2
- No overrides, no exceptions

## License

UNLICENSED - Single source of truth: `/spec/VisionFrames_v1.pdf`
