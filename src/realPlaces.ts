/**
 * Vision Frames v2 - Real places for broad destinations
 * Source: docs/DECISIONS.md V2-04 (owner request, 2026-11-18)
 *
 * When a customer's place is only a destination, such as "Japan" or "Osaka", the frame is
 * set in a real, named place there, taken from an owner-approved list for that destination.
 * Nothing is chosen or generated at order time: every place on a list carries the Wikidata
 * item that proves it exists, `npm run check:places` confirms each one against Wikidata,
 * and the owner reviews the lists before they ship. A place the customer named themselves,
 * or a destination with no list, is kept as typed.
 *
 * The frame picture is the image model's rendering of the place, not a photograph of it.
 */

import { BOARD } from './config';
import { normalizeField } from './normalize';

export interface RealPlace {
  /** Name as the customer sees it, e.g. "Philosopher's Path" */
  name: string;
  /** City or area it is in, as the customer sees it */
  city: string;
  /** Wikidata item proving the place exists, e.g. "Q42" */
  wikidata: string;
  /** Latitude and longitude in degrees, as Wikidata records them */
  coordinates: readonly [number, number];
}

export interface Destination {
  /** Stable key for run records, e.g. "tokyo" */
  key: string;
  /** Country name used in each frame's setting, e.g. "Japan" */
  country: string;
  /** Wikidata item for the destination itself */
  wikidata: string;
  /** What a customer may type for it, e.g. ["Tokyo", "Tokyo, Japan"] */
  names: readonly string[];
  /** Owner-approved places; at least as many as the largest board */
  places: readonly RealPlace[];
}

/**
 * Owner-approved destination lists. Empty until the first lists (Japan, Tokyo, Kyoto and
 * Osaka) are sourced from Wikidata, pass `npm run check:places`, and are approved by the
 * owner. Until then every typed destination is kept as typed.
 */
export const REAL_PLACE_DESTINATIONS: readonly Destination[] = [];

/**
 * Light for successive real-place frames on one board, so frames differ in light as well as
 * place. Night and dusk come first because the canonical prompt favors them.
 */
export const REAL_PLACE_LIGHTS: readonly string[] = ['at dusk', 'at night', 'in early morning light'];

/** Words around a bare destination that do not make it any more specific */
const LEADING_FILLER = /^(?:(?:somewhere|anywhere|around|in|the)\s+)+/;

/** Lowercase, accents removed, punctuation as spaces: "Tōkyō, Japan!" -> "tokyo japan" */
export function simplify(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * The destination a typed place names when it names nothing more specific, such as
 * "Japan", "somewhere in Osaka" or "Tokyo, Japan". Anything else, including "a quiet
 * street in Tokyo" or "Tokyo at night", is not a bare destination.
 */
export function matchDestination(typed: string, destinations: readonly Destination[]): Destination | undefined {
  const words = simplify(typed).replace(LEADING_FILLER, '');
  if (!words) {
    return undefined;
  }
  return destinations.find((destination) => destination.names.some((name) => simplify(name) === words));
}

/** The frame's environment preference for a real place, e.g. "Philosopher's Path, Kyoto, Japan, at dusk" */
export function realPlaceSetting(place: RealPlace, destination: Destination, light: string): string {
  return `${place.name}, ${place.city}, ${destination.country}, ${light}`;
}

/** What the customer is told about the frame's place, e.g. "Philosopher's Path, Kyoto" */
export function realPlaceLabel(place: RealPlace): string {
  return `${place.name}, ${place.city}`;
}

const WIKIDATA_ITEM = /^Q[1-9]\d*$/;

/**
 * Throw if a destination list could repeat a place on one board, cannot fill the largest
 * board, names something two ways, carries a malformed Wikidata item or coordinates, or
 * holds a place whose setting the intake filter would change. A configuration error, not a
 * customer error. Whether each place really exists is `npm run check:places`.
 */
export function assertUsableDestinations(destinations: readonly Destination[]): void {
  const largest = Math.max(...BOARD.sizes);
  const keys = new Set<string>();
  const names = new Set<string>();
  for (const destination of destinations) {
    if (keys.has(destination.key)) {
      throw new Error(`destination ${destination.key} is listed twice`);
    }
    keys.add(destination.key);
    if (!WIKIDATA_ITEM.test(destination.wikidata)) {
      throw new Error(`destination ${destination.key} has a malformed Wikidata item`);
    }
    for (const name of destination.names) {
      const simple = simplify(name).replace(LEADING_FILLER, '');
      if (!simple || names.has(simple)) {
        throw new Error(`destination ${destination.key} has an empty or repeated name`);
      }
      names.add(simple);
    }
    if (destination.places.length < largest) {
      throw new Error(`destination ${destination.key} needs at least ${largest} places`);
    }
    const items = new Set<string>();
    for (const place of destination.places) {
      const [latitude, longitude] = place.coordinates;
      if (!WIKIDATA_ITEM.test(place.wikidata) || items.has(place.wikidata)) {
        throw new Error(`destination ${destination.key} has a malformed or repeated Wikidata item`);
      }
      items.add(place.wikidata);
      if (!(Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180)) {
        throw new Error(`destination ${destination.key} has invalid coordinates for ${place.wikidata}`);
      }
      for (const light of REAL_PLACE_LIGHTS) {
        const setting = realPlaceSetting(place, destination, light);
        if (normalizeField(setting) !== setting) {
          throw new Error(`destination ${destination.key} has a place the intake filter changes: ${place.wikidata}`);
        }
      }
    }
  }
}
