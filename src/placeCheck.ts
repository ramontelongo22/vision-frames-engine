/**
 * Vision Frames v2 - Real-place verification against Wikidata (V2-04)
 *
 * Every place on a destination list must be a real, named place. This check confirms,
 * for each listed Wikidata item, that the item exists (and was not merged into another),
 * that its English label or an English alias is the name we show, that its recorded
 * coordinates are within a short distance of ours, that it is in the destination's
 * country, and, for a city, that it lies near that city. It changes nothing; the CLI in
 * `checkPlaces.ts` runs it against the live Wikidata API.
 */

import { Destination, simplify } from './realPlaces';

interface Claim {
  mainsnak?: { datavalue?: { value?: unknown } };
}

/** The parts of a Wikidata entity the check reads */
export interface WikidataEntity {
  id: string;
  labels?: Record<string, { value: string }>;
  aliases?: Record<string, Array<{ value: string }>>;
  claims?: Record<string, Claim[]>;
}

/** Returns the entity for an item id, or undefined when Wikidata has no such item */
export type EntityFetcher = (id: string) => Promise<WikidataEntity | undefined>;

export interface PlaceProblem {
  destination: string;
  wikidata: string;
  problem: string;
}

export interface PlaceCheckOptions {
  /** How far our coordinates may be from Wikidata's */
  maxOffsetKm: number;
  /** How far a city's places may be from the city's own coordinates */
  maxCityRadiusKm: number;
}

const DEFAULTS: PlaceCheckOptions = { maxOffsetKm: 1, maxCityRadiusKm: 60 };

/** Great-circle distance in km */
export function distanceKm(a: readonly [number, number], b: readonly [number, number]): number {
  const rad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * rad;
  const dLon = (b[1] - a[1]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

function coordinates(entity: WikidataEntity): [number, number] | undefined {
  const value = entity.claims?.P625?.[0]?.mainsnak?.datavalue?.value as { latitude?: unknown; longitude?: unknown } | undefined;
  return typeof value?.latitude === 'number' && typeof value.longitude === 'number'
    ? [value.latitude, value.longitude]
    : undefined;
}

function itemIds(entity: WikidataEntity, property: string): Set<string> {
  const ids = new Set<string>();
  for (const claim of entity.claims?.[property] ?? []) {
    const value = claim.mainsnak?.datavalue?.value as { id?: unknown } | undefined;
    if (typeof value?.id === 'string') {
      ids.add(value.id);
    }
  }
  return ids;
}

function englishNames(entity: WikidataEntity): string[] {
  return [entity.labels?.en?.value, ...(entity.aliases?.en ?? []).map((alias) => alias.value)].filter(
    (name): name is string => typeof name === 'string'
  );
}

/**
 * Check every place on every destination list. Returns the problems found; an empty list
 * means every place passed. Network errors from `fetchEntity` propagate.
 */
export async function checkDestinations(
  destinations: readonly Destination[],
  fetchEntity: EntityFetcher,
  options: PlaceCheckOptions = DEFAULTS
): Promise<PlaceProblem[]> {
  const problems: PlaceProblem[] = [];

  for (const destination of destinations) {
    const report = (wikidata: string, problem: string) => problems.push({ destination: destination.key, wikidata, problem });
    const area = await fetchEntity(destination.wikidata);
    if (!area || area.id !== destination.wikidata) {
      report(destination.wikidata, area ? `merged into ${area.id}` : 'no such Wikidata item');
      continue;
    }
    const countries = itemIds(area, 'P17');
    // A country's own country is itself; anything else is checked against its centre
    const centre = countries.has(area.id) ? undefined : coordinates(area);

    for (const place of destination.places) {
      const entity = await fetchEntity(place.wikidata);
      if (!entity || entity.id !== place.wikidata) {
        report(place.wikidata, entity ? `merged into ${entity.id}` : 'no such Wikidata item');
        continue;
      }
      const names = englishNames(entity);
      if (!names.some((name) => simplify(name) === simplify(place.name))) {
        report(place.wikidata, `name "${place.name}" is not its English label or alias (label: "${names[0] ?? 'none'}")`);
      }
      const recorded = coordinates(entity);
      if (!recorded) {
        report(place.wikidata, 'Wikidata has no coordinates for it');
      } else {
        const offset = distanceKm(recorded, place.coordinates);
        if (offset > options.maxOffsetKm) {
          report(place.wikidata, `coordinates are ${offset.toFixed(1)} km from Wikidata's`);
        }
        if (centre && distanceKm(recorded, centre) > options.maxCityRadiusKm) {
          report(place.wikidata, `${distanceKm(recorded, centre).toFixed(0)} km from the centre of ${destination.key}`);
        }
      }
      const placeCountries = itemIds(entity, 'P17');
      if (![...placeCountries].some((country) => countries.has(country))) {
        report(place.wikidata, `not in the same country as ${destination.key}`);
      }
    }
  }
  return problems;
}
