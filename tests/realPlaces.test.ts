/**
 * v2 real places for broad destinations (V2-04)
 *
 * The destinations here are test fixtures, not places: the shipped lists come from
 * Wikidata and are checked by `npm run check:places`.
 */

import { BOARD } from '../src/config';
import { normalizeField } from '../src/normalize';
import {
  Destination,
  REAL_PLACE_DESTINATIONS,
  REAL_PLACE_LIGHTS,
  RealPlace,
  assertUsableDestinations,
  matchDestination,
  realPlaceLabel,
  realPlaceSetting,
  simplify,
} from '../src/realPlaces';
import { fixtureDestination } from './helpers';

const COUNTRY = fixtureDestination('country', ['Testland']);
const CITY = fixtureDestination('city', ['Testburg', 'Testburg, Testland'], 9, 2000);
const DESTINATIONS = [COUNTRY, CITY];

describe('simplify', () => {
  it('lowercases, removes accents and turns punctuation into single spaces', () => {
    expect(simplify('Tōkyō, Japan!')).toBe('tokyo japan');
    expect(simplify('  Kyōto  ')).toBe('kyoto');
    expect(simplify('Ōsaka-fu')).toBe('osaka fu');
  });
});

describe('matchDestination', () => {
  it('matches a bare destination however it is cased, accented or punctuated', () => {
    for (const typed of ['Testland', 'testland', '  TESTLAND ', 'Testland!', 'Tëstland']) {
      expect(matchDestination(typed, DESTINATIONS)).toBe(COUNTRY);
    }
    expect(matchDestination('Testburg, Testland', DESTINATIONS)).toBe(CITY);
    expect(matchDestination('testburg testland', DESTINATIONS)).toBe(CITY);
  });

  it('matches through words that add nothing, such as "somewhere in"', () => {
    for (const typed of ['somewhere in Testburg', 'in Testburg', 'anywhere in the Testburg', 'around Testburg']) {
      expect(matchDestination(typed, DESTINATIONS)).toBe(CITY);
    }
  });

  it('does not match anything more specific than the destination', () => {
    for (const typed of [
      'a quiet street in Testburg',
      'Testburg at night',
      'Testburg harbour',
      'north Testland',
      'Testburg or Testland',
    ]) {
      expect(matchDestination(typed, DESTINATIONS)).toBeUndefined();
    }
  });

  it('does not match an empty or filler-only entry, or a destination with no list', () => {
    for (const typed of ['', '   ', 'somewhere', 'in the', 'Paris']) {
      expect(matchDestination(typed, DESTINATIONS)).toBeUndefined();
    }
  });
});

describe('setting and label', () => {
  const place = CITY.places[0];

  it('builds the frame setting from name, city, country and light', () => {
    expect(realPlaceSetting(place, CITY, 'at dusk')).toBe('city Spot 1, city City, Testland, at dusk');
  });

  it('shows the customer the name and city', () => {
    expect(realPlaceLabel(place)).toBe('city Spot 1, city City');
  });

  it('has lights that pass the intake filter unchanged', () => {
    expect(REAL_PLACE_LIGHTS.length).toBeGreaterThan(1);
    for (const light of REAL_PLACE_LIGHTS) {
      expect(normalizeField(light)).toBe(light);
    }
  });
});

describe('assertUsableDestinations', () => {
  const largest = Math.max(...BOARD.sizes);
  const withPlace = (destination: Destination, index: number, change: Partial<RealPlace>): Destination => ({
    ...destination,
    places: destination.places.map((place, i) => (i === index ? { ...place, ...change } : place)),
  });

  it('accepts the shipped lists and well-formed fixtures', () => {
    expect(() => assertUsableDestinations(REAL_PLACE_DESTINATIONS)).not.toThrow();
    expect(() => assertUsableDestinations(DESTINATIONS)).not.toThrow();
    expect(() => assertUsableDestinations([])).not.toThrow();
  });

  it('rejects a repeated key, a malformed destination item, and an empty or repeated name', () => {
    expect(() => assertUsableDestinations([COUNTRY, { ...CITY, key: 'country' }])).toThrow('listed twice');
    expect(() => assertUsableDestinations([{ ...CITY, wikidata: 'Q0' }])).toThrow('malformed Wikidata item');
    expect(() => assertUsableDestinations([{ ...CITY, wikidata: '2000' }])).toThrow('malformed Wikidata item');
    expect(() => assertUsableDestinations([{ ...CITY, names: ['Testburg', '!!!'] }])).toThrow('empty or repeated');
    expect(() => assertUsableDestinations([COUNTRY, { ...CITY, names: ['in Testland'] }])).toThrow('empty or repeated');
  });

  it(`rejects a list that cannot fill a board of ${largest} without repeating a place`, () => {
    expect(() => assertUsableDestinations([fixtureDestination('short', ['Short'], largest - 1)])).toThrow(
      `at least ${largest} places`
    );
  });

  it('rejects a malformed or repeated place item and impossible coordinates', () => {
    expect(() => assertUsableDestinations([withPlace(CITY, 1, { wikidata: 'Q2000' })])).toThrow('malformed or repeated');
    expect(() => assertUsableDestinations([withPlace(CITY, 1, { wikidata: 'q2001' })])).toThrow('malformed or repeated');
    expect(() => assertUsableDestinations([withPlace(CITY, 1, { coordinates: [91, 0] })])).toThrow('invalid coordinates');
    expect(() => assertUsableDestinations([withPlace(CITY, 1, { coordinates: [0, Number.NaN] })])).toThrow(
      'invalid coordinates'
    );
  });

  it('rejects a place whose setting the intake filter would change', () => {
    // The filter turns an apostrophe into a space and drops action words
    expect(() => assertUsableDestinations([withPlace(CITY, 2, { name: "Philosopher's Path" })])).toThrow(
      'intake filter changes'
    );
    expect(() => assertUsableDestinations([withPlace(CITY, 2, { name: 'Walking Trail' })])).toThrow('intake filter changes');
  });
});
