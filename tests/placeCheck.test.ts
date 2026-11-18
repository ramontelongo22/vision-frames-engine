/**
 * v2 real-place verification against Wikidata (V2-04), with a fake Wikidata
 *
 * The live check is `npm run check:places`; these tests prove what it reports.
 */

import { EntityFetcher, WikidataEntity, checkDestinations, distanceKm } from '../src/placeCheck';
import { Destination } from '../src/realPlaces';
import { fixtureDestination } from './helpers';

const COUNTRY_ID = 'Q17';
const OTHER_COUNTRY_ID = 'Q30';

function claimItem(id: string) {
  return { mainsnak: { datavalue: { value: { id } } } };
}

function claimPoint(latitude: number, longitude: number) {
  return { mainsnak: { datavalue: { value: { latitude, longitude } } } };
}

function entity(
  id: string,
  label: string,
  coordinates: readonly [number, number] | undefined,
  country: string = COUNTRY_ID,
  aliases: string[] = []
): WikidataEntity {
  return {
    id,
    labels: { en: { value: label } },
    aliases: { en: aliases.map((value) => ({ value })) },
    claims: {
      P17: [claimItem(country)],
      ...(coordinates ? { P625: [claimPoint(coordinates[0], coordinates[1])] } : {}),
    },
  };
}

/** A fake Wikidata that agrees with every place on the list */
function wikidataFor(destination: Destination, centre: readonly [number, number] = [35.04, 135.04]): Map<string, WikidataEntity> {
  const items = new Map<string, WikidataEntity>();
  items.set(destination.wikidata, entity(destination.wikidata, destination.names[0], centre));
  for (const place of destination.places) {
    items.set(place.wikidata, entity(place.wikidata, place.name, place.coordinates));
  }
  return items;
}

function fetcher(items: Map<string, WikidataEntity>): EntityFetcher & { calls: string[] } {
  const calls: string[] = [];
  const fetchEntity = async (id: string) => {
    calls.push(id);
    return items.get(id);
  };
  return Object.assign(fetchEntity, { calls });
}

const CITY = fixtureDestination('city', ['Testburg']);
const place = CITY.places[0];

describe('distanceKm', () => {
  it('measures great-circle distance', () => {
    expect(distanceKm([0, 0], [0, 0])).toBe(0);
    // One degree of latitude is about 111 km
    expect(distanceKm([35, 135], [36, 135])).toBeCloseTo(111.2, 0);
    expect(distanceKm([0, 179.5], [0, -179.5])).toBeCloseTo(111.2, 0);
  });
});

describe('checkDestinations', () => {
  it('finds no problem when Wikidata agrees with every place, and looks up each item once', async () => {
    const fetchEntity = fetcher(wikidataFor(CITY));
    expect(await checkDestinations([CITY], fetchEntity)).toEqual([]);
    expect(fetchEntity.calls).toEqual([CITY.wikidata, ...CITY.places.map((p) => p.wikidata)]);
  });

  it('accepts an English alias, and a name that differs only in accents, case or punctuation', async () => {
    const items = wikidataFor(CITY);
    items.set(place.wikidata, entity(place.wikidata, 'Some Other Label', place.coordinates, COUNTRY_ID, [place.name]));
    const second = CITY.places[1];
    items.set(second.wikidata, entity(second.wikidata, `${second.name.toUpperCase()}!`.replace('O', 'Ō'), second.coordinates));
    expect(await checkDestinations([CITY], fetcher(items))).toEqual([]);
  });

  it('reports a place that does not exist, or was merged into another item', async () => {
    const items = wikidataFor(CITY);
    items.delete(place.wikidata);
    const second = CITY.places[1];
    items.set(second.wikidata, entity('Q999999', second.name, second.coordinates));

    expect(await checkDestinations([CITY], fetcher(items))).toEqual([
      { destination: 'city', wikidata: place.wikidata, problem: 'no such Wikidata item' },
      { destination: 'city', wikidata: second.wikidata, problem: 'merged into Q999999' },
    ]);
  });

  it('skips the places of a destination whose own item does not exist', async () => {
    const items = wikidataFor(CITY);
    items.delete(CITY.wikidata);
    const fetchEntity = fetcher(items);

    expect(await checkDestinations([CITY], fetchEntity)).toEqual([
      { destination: 'city', wikidata: CITY.wikidata, problem: 'no such Wikidata item' },
    ]);
    expect(fetchEntity.calls).toEqual([CITY.wikidata]);
  });

  it('reports a name that is not the English label or an alias', async () => {
    const items = wikidataFor(CITY);
    items.set(place.wikidata, entity(place.wikidata, 'A Different Temple', place.coordinates));

    expect(await checkDestinations([CITY], fetcher(items))).toEqual([
      {
        destination: 'city',
        wikidata: place.wikidata,
        problem: `name "${place.name}" is not its English label or alias (label: "A Different Temple")`,
      },
    ]);
  });

  it('reports missing coordinates, and coordinates more than 1 km from ours', async () => {
    const items = wikidataFor(CITY);
    items.set(place.wikidata, entity(place.wikidata, place.name, undefined));
    const second = CITY.places[1];
    items.set(second.wikidata, entity(second.wikidata, second.name, [second.coordinates[0] + 0.02, second.coordinates[1]]));
    const third = CITY.places[2];
    items.set(third.wikidata, entity(third.wikidata, third.name, [third.coordinates[0] + 0.005, third.coordinates[1]]));

    expect(await checkDestinations([CITY], fetcher(items))).toEqual([
      { destination: 'city', wikidata: place.wikidata, problem: 'Wikidata has no coordinates for it' },
      { destination: 'city', wikidata: second.wikidata, problem: "coordinates are 2.2 km from Wikidata's" },
    ]);
  });

  it("reports a city's place that lies far from the city", async () => {
    const far: [number, number] = [36.5, 135.0];
    const listed = { ...CITY, places: CITY.places.map((p, i) => (i === 0 ? { ...p, coordinates: far } : p)) };
    const items = wikidataFor(listed);

    expect(await checkDestinations([listed], fetcher(items))).toEqual([
      { destination: 'city', wikidata: place.wikidata, problem: '162 km from the centre of city' },
    ]);
  });

  it('does not apply the city radius to a country, which is its own country', async () => {
    const country = fixtureDestination('country', ['Testland'], 9, 2000);
    const spread = { ...country, places: country.places.map((p, i) => ({ ...p, coordinates: [30 + i, 130 + i] as const })) };
    const items = wikidataFor(spread);
    items.set(spread.wikidata, entity(spread.wikidata, 'Testland', [36, 138], spread.wikidata));
    for (const p of spread.places) {
      items.set(p.wikidata, entity(p.wikidata, p.name, p.coordinates, spread.wikidata));
    }

    expect(await checkDestinations([spread], fetcher(items))).toEqual([]);
  });

  it('reports a place in a different country', async () => {
    const items = wikidataFor(CITY);
    items.set(place.wikidata, entity(place.wikidata, place.name, place.coordinates, OTHER_COUNTRY_ID));

    expect(await checkDestinations([CITY], fetcher(items))).toEqual([
      { destination: 'city', wikidata: place.wikidata, problem: 'not in the same country as city' },
    ]);
  });

  it('lets network errors through instead of passing the list', async () => {
    const failing: EntityFetcher = async () => {
      throw new Error('Wikidata returned HTTP 503 for Q1');
    };
    await expect(checkDestinations([CITY], failing)).rejects.toThrow('HTTP 503');
  });
});
