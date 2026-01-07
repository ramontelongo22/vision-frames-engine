# Vision Frames v1 - Quick Reference Card

## Single Source of Truth
`/spec/VisionFrames_v1.pdf`

## Install & Run
```bash
npm install    # Install dependencies
npm run build  # Compile TypeScript
npm test       # Run all tests
```

## Core Constraints

### 3 Fields Only (schema.ts)
```typescript
{
  identityDirection: string;      // Required
  environmentPreference?: string; // Optional (broad only)
  moodTone?: string;             // Optional
}
```

### Disallowed Words (normalize.ts)
- manifest, wealthy, rich, successful, hustle, grind
- fantasy, dream life, glow-up, upgrade
- Actions: sitting, holding, working, gesturing
- Objects: laptop, phone, briefcase, coffee
- Roles: CEO, founder, entrepreneur
- Commands: create, generate, show

### Canonical Prompt (promptBuilder.ts)
Fixed template from PDF Section 4. Only inserts 3 variables. Never modified.

### QA Gate Auto-Discard (qaGate.ts)
- ❌ Subject is seated
- ❌ Objects or props appear
- ❌ Multiple people appear
- ❌ Likeness drifts or feels AI/stock
- ❌ Over-stylized or surreal
- ❌ Explicit wealth or status signaling
- ❌ Close-ups or extreme angles

### Limits (config.ts)
```typescript
maxGenerations: 3
maxRefinements: 2
```

### Allowed Refinements Only
- Lighting
- Environment tone
- Minor framing (still wide)

### Hard Stops (engine.ts)
- Likeness fails twice
- Same violation repeats
- Quality degrades with retries

### Exit Reasons
- `success` - Image passed QA ✅
- `generations_exhausted` - Max 3 attempts used
- `refinements_exhausted` - Max 2 refinements used
- `likeness_failed_twice` - Hard stop
- `repeat_violations` - Hard stop
- `quality_degrading` - Hard stop

## Allowed Visual Elements

### Actions
✅ Standing, Walking (slow), Entering/Exiting, Still presence
❌ Sitting, Holding objects, Working, Gesturing, Running, Social interaction

### Camera
✅ Medium-wide to wide, Eye-level or slightly low
❌ Close-ups, Extreme angles

### Lighting
✅ Night, Dusk, Low-key interiors (controlled, cinematic)
❌ (Not specified, but implied: bright/harsh lighting)

### Subject
✅ Single individual, Low-action state, Calm presence
❌ Multiple people, Active work, Object handling, Social scenes

## State Machine Flow

```
Raw Input
    ↓
Normalize (silent filtering)
    ↓
Build Canonical Prompt (verbatim)
    ↓
Generation Loop (1-3 attempts)
    ↓
QA Gate (pass/fail)
    ↓
[if pass] Refinement Loop (0-2 attempts)
    ↓
QA Gate (pass/fail)
    ↓
Exit: Success or Silent Stop
```

## Version Freeze

- ✅ One PDF = law
- ✅ Canonical prompt is final
- ❌ No overrides
- ❌ No exceptions
- 🔄 Changes require Vision Frames v2

## Key Principles

1. **Silent Operation**: Never notify user of filtering/normalization
2. **No Fixes**: Never attempt to fix face/body/pose/action
3. **Auto-Discard**: Fail immediately on any violation
4. **Hard Limits**: Stop at max attempts or hard stop conditions
5. **Identity-First**: Focus on being, not doing
6. **Grounded Reality**: Contemporary, real, calm presence
7. **Non-Transactional**: No wealth, success, outcomes, or promises

## File Reference

| File | Purpose |
|------|---------|
| [src/schema.ts](src/schema.ts) | 3-field Clean Intent |
| [src/normalize.ts](src/normalize.ts) | Silent input filtering |
| [src/promptBuilder.ts](src/promptBuilder.ts) | Canonical prompt (verbatim) |
| [src/qaGate.ts](src/qaGate.ts) | Pass/fail validation |
| [src/config.ts](src/config.ts) | Hard-coded limits |
| [src/engine.ts](src/engine.ts) | State machine |
| [tests/normalize.test.ts](tests/normalize.test.ts) | Normalization tests |
| [tests/qaGate.test.ts](tests/qaGate.test.ts) | QA gate tests |
| [tests/engine.test.ts](tests/engine.test.ts) | Engine tests |

## Test Coverage

- ✅ All disallowed words stripped
- ✅ All QA violations detected
- ✅ All counters enforce limits
- ✅ All exit conditions work
- ✅ All hard stops trigger
- ✅ Silent operation (no throws)

Target: 80% coverage (branches, functions, lines, statements)
