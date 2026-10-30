/**
 * v2 board size and place intake (V2-02)
 */

import {
  BOARD_SETTINGS_DRAFT,
  assertUsableSettings,
  isBoardSize,
  planPlaces,
  validatePlaces,
} from '../src/boardPlaces';
import { LIMITS } from '../src/config';
import { normalizeField } from '../src/normalize';

/** Deterministic stand-in for Math.random */
function seeded(seed = 1): () => number {
  let state = seed;
  return () => {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
}

describe('isBoardSize', () => {
  it('accepts only the owner-approved tiers', () => {
    expect([3, 7, 9].every(isBoardSize)).toBe(true);
    for (const value of [0, 1, 2, 4, 8, 10, '3', 7.5, null, undefined]) {
      expect(isBoardSize(value)).toBe(false);
    }
  });
});

describe('validatePlaces', () => {
  it('treats a missing list as all blanks', () => {
    expect(validatePlaces(undefined, 3)).toEqual({ ok: true, places: [] });
    expect(validatePlaces(null, 3)).toEqual({ ok: true, places: [] });
  });

  it('turns null and undefined entries into blanks', () => {
    expect(validatePlaces(['a quiet street', null, undefined], 3)).toEqual({
      ok: true,
      places: ['a quiet street', '', ''],
    });
  });

  it('rejects a non-list, more places than frames, non-text and over-long entries', () => {
    expect(validatePlaces('a quiet street', 3)).toEqual({ ok: false, reason: 'places must be an array' });
    expect(validatePlaces(['a', 'b', 'c', 'd'], 3)).toEqual({ ok: false, reason: 'more places than frames' });
    expect(validatePlaces(['a', 42], 3)).toEqual({ ok: false, reason: 'place 2 must be a string' });
    expect(validatePlaces(['x'.repeat(LIMITS.maxRawFieldLength + 1)], 3)).toEqual({
      ok: false,
      reason: 'place 1 exceeds the maximum length',
    });
  });

  it('never puts the customer text in a rejection reason', () => {
    const result = validatePlaces(['my secret garden', { text: 'my secret garden' }], 3);
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain('secret');
  });
});

describe('planPlaces', () => {
  const settings = BOARD_SETTINGS_DRAFT;

  it('puts typed places first, in order, then fills the rest from the settings list', () => {
    const plan = planPlaces(['a quiet street at dusk', 'a misty harbour'], 7, settings, seeded());

    expect(plan).toHaveLength(7);
    expect(plan.slice(0, 2)).toEqual([
      { source: 'customer', place: 'a quiet street at dusk' },
      { source: 'customer', place: 'a misty harbour' },
    ]);
    for (const filled of plan.slice(2)) {
      expect(filled.source).toBe('settings_list');
      expect(settings).toContain(filled.place);
    }
  });

  it('never uses a setting twice on one board', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const filled = planPlaces([], 9, settings, seeded(seed)).map((p) => p.place);
      expect(new Set(filled).size).toBe(9);
    }
  });

  it('allows the customer to type the same place more than once', () => {
    const plan = planPlaces(['a quiet street', 'a quiet street', 'a quiet street'], 3, settings, seeded());
    expect(plan.map((p) => p.source)).toEqual(['customer', 'customer', 'customer']);
  });

  it('counts a typed place that filters down to nothing as a blank', () => {
    const plan = planPlaces(['sitting at a desk holding coffee', '', 'a quiet street'], 3, settings, seeded());
    expect(plan[0]).toEqual({ source: 'customer', place: 'a quiet street' });
    expect(plan.slice(1).map((p) => p.source)).toEqual(['settings_list', 'settings_list']);
  });

  it('passes a surviving typed place on as typed, for the frame run to filter like the environment field', () => {
    const plan = planPlaces(['a quiet street while walking'], 3, settings, seeded());
    expect(plan[0].place).toBe('a quiet street while walking');
  });

  it('chooses fill-in settings from the random source', () => {
    const a = planPlaces([], 3, settings, seeded(1)).map((p) => p.place);
    const b = planPlaces([], 3, settings, seeded(1)).map((p) => p.place);
    const c = planPlaces([], 3, settings, () => 0).map((p) => p.place);
    expect(a).toEqual(b);
    expect(c).toEqual(settings.slice(0, 3));
  });
});

describe('settings list', () => {
  it('the draft list fills the largest board and passes the intake filter unchanged', () => {
    expect(() => assertUsableSettings(BOARD_SETTINGS_DRAFT)).not.toThrow();
    for (const setting of BOARD_SETTINGS_DRAFT) {
      expect(normalizeField(setting)).toBe(setting);
    }
  });

  it('rejects a list that is too short, repeats an entry, or holds a filtered word', () => {
    expect(() => assertUsableSettings(BOARD_SETTINGS_DRAFT.slice(0, 8))).toThrow('at least 9');
    expect(() => assertUsableSettings([...BOARD_SETTINGS_DRAFT.slice(0, 9), BOARD_SETTINGS_DRAFT[0]])).toThrow('repeats');
    expect(() => assertUsableSettings([...BOARD_SETTINGS_DRAFT.slice(0, 8), 'A desk where someone is working'])).toThrow(
      'filter changes'
    );
  });
});
