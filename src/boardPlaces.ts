/**
 * Vision Frames v2 - Board size and place intake
 * Source: docs/DECISIONS.md V2-02 (owner-approved board spec, 2026-10-30)
 *
 * A board is 3, 7 or 9 frames. The customer may type up to one place per frame. Each
 * typed place becomes that frame's environment preference and is filtered exactly like
 * the v1 environment field by the frame's own engine run. A typed place that filters
 * down to nothing counts as a blank. Blanks are filled from the owner's settings list,
 * with no setting used twice on one board; typed places may repeat.
 *
 * Board order is the typed places in the order given, then the filled-in settings.
 */

import { BOARD, LIMITS } from './config';
import { normalizeField } from './normalize';

export type BoardSize = (typeof BOARD.sizes)[number];

export function isBoardSize(value: unknown): value is BoardSize {
  return (BOARD.sizes as readonly unknown[]).includes(value);
}

/**
 * DRAFT fill-in settings from the approved board spec. The owner has not yet marked
 * them Keep, Drop or Reword; this list changes when those marks arrive. Every entry
 * must be a place where one person standing or walking alone looks natural, with no
 * props, work, seating, crowds or wealth signals, and must pass the intake filter
 * unchanged.
 */
export const BOARD_SETTINGS_DRAFT: readonly string[] = [
  'A quiet city street at dusk',
  'A tree-lined park path in morning light',
  'A coastal path above the sea at golden hour',
  'A forest trail in soft daylight',
  'A lakeside shore at sunrise',
  'A mountain overlook on a clear day',
  'A footbridge over a river at dusk',
  'A sunlit garden path',
  'A wide beach in late afternoon light',
  'An open field under an evening sky',
  'A bright kitchen in morning light',
  'A calm living room by a tall window',
];

export interface PlannedPlace {
  source: 'customer' | 'settings_list';
  /** Passed to the frame's engine run as its environment preference */
  place: string;
}

export type PlacesValidation = { ok: true; places: string[] } | { ok: false; reason: string };

/**
 * Check the customer's place list against the board size. Missing, null and empty
 * entries are blanks. Reasons never include the customer's text.
 */
export function validatePlaces(raw: unknown, size: BoardSize): PlacesValidation {
  if (raw === undefined || raw === null) {
    return { ok: true, places: [] };
  }
  if (!Array.isArray(raw)) {
    return { ok: false, reason: 'places must be an array' };
  }
  if (raw.length > size) {
    return { ok: false, reason: 'more places than frames' };
  }
  const places: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    const entry: unknown = raw[i];
    if (entry === undefined || entry === null) {
      places.push('');
      continue;
    }
    if (typeof entry !== 'string') {
      return { ok: false, reason: `place ${i + 1} must be a string` };
    }
    if (entry.length > LIMITS.maxRawFieldLength) {
      return { ok: false, reason: `place ${i + 1} exceeds the maximum length` };
    }
    places.push(entry);
  }
  return { ok: true, places };
}

/**
 * Throw if a settings list cannot fill every blank of the largest board, repeats an
 * entry, or holds an entry the intake filter would change. A configuration error, not
 * a customer error.
 */
export function assertUsableSettings(settings: readonly string[]): void {
  const largest = Math.max(...BOARD.sizes);
  if (new Set(settings).size !== settings.length) {
    throw new Error('board settings list repeats an entry');
  }
  if (settings.length < largest) {
    throw new Error(`board settings list needs at least ${largest} entries`);
  }
  for (const setting of settings) {
    if (normalizeField(setting) !== setting) {
      throw new Error('board settings list holds an entry the intake filter changes');
    }
  }
}

/**
 * One place per frame: typed places that survive the filter, in order, then settings
 * chosen at random without repeats for the remaining frames.
 */
export function planPlaces(
  typed: readonly string[],
  size: BoardSize,
  settings: readonly string[],
  random: () => number = Math.random
): PlannedPlace[] {
  const plan: PlannedPlace[] = typed
    .filter((place) => normalizeField(place) !== '')
    .map((place) => ({ source: 'customer' as const, place }));

  const pool = [...settings];
  // Fisher-Yates, stopping once enough settings are drawn
  for (let i = 0; plan.length < size; i++) {
    if (i >= pool.length) {
      throw new Error('invariant: settings list is shorter than the board');
    }
    const pick = i + Math.floor(random() * (pool.length - i));
    [pool[i], pool[pick]] = [pool[pick], pool[i]];
    plan.push({ source: 'settings_list', place: pool[i] });
  }
  return plan;
}
