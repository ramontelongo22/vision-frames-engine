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
 * Destination lists for Japan, Tokyo, Kyoto and Osaka. Every name is the item's English
 * label or alias on Wikidata and every coordinate is its P625 value; the raw query results
 * the places were picked from are in data/wikidata-candidates/. They pass
 * `npm run check:places` but still await the owner's approval (V2-04). The Japan list keeps
 * to places outside the three city lists so a Japan board does not overlap them.
 */
export const REAL_PLACE_DESTINATIONS: readonly Destination[] = [
  {
    key: 'japan',
    country: 'Japan',
    wikidata: 'Q17',
    names: ['Japan'],
    places: [
      { name: 'Nara Park', city: 'Nara', wikidata: 'Q1186358', coordinates: [34.685453, 135.843411] },
      { name: 'Kasuga-taisha', city: 'Nara', wikidata: 'Q714559', coordinates: [34.681336, 135.848348] },
      { name: 'Isui-en', city: 'Nara', wikidata: 'Q2745677', coordinates: [34.685791, 135.837742] },
      { name: 'Lake Ashi', city: 'Hakone', wikidata: 'Q187053', coordinates: [35.211670, 139.003890] },
      { name: 'Kenroku-en', city: 'Kanazawa', wikidata: 'Q998239', coordinates: [36.561944, 136.662500] },
      { name: 'Momijidani Park', city: 'Hatsukaichi', wikidata: 'Q6897278', coordinates: [34.294191, 132.324057] },
      { name: 'Lake Kawaguchi', city: 'Fujikawaguchiko', wikidata: 'Q577372', coordinates: [35.515000, 138.756667] },
      { name: 'Kamikōchi', city: 'Matsumoto', wikidata: 'Q1048234', coordinates: [36.246969, 137.633333] },
      { name: 'Otaru Canal', city: 'Otaru', wikidata: 'Q10959355', coordinates: [43.199722, 141.001667] },
      { name: 'Byōdō-in Temple', city: 'Uji', wikidata: 'Q61094', coordinates: [34.889444, 135.807778] },
      { name: 'Hōkoku-ji Temple', city: 'Kamakura', wikidata: 'Q3146363', coordinates: [35.320000, 139.569300] },
      { name: 'Shichirigahama', city: 'Kamakura', wikidata: 'Q7496115', coordinates: [35.304444, 139.512500] },
      { name: 'Megane Bridge', city: 'Nagasaki', wikidata: 'Q74710', coordinates: [32.747207, 129.880087] },
      { name: 'Engaku-ji Temple', city: 'Kamakura', wikidata: 'Q954860', coordinates: [35.337704, 139.547498] },
    ],
  },
  {
    key: 'tokyo',
    country: 'Japan',
    wikidata: 'Q1490',
    names: ['Tokyo', 'Tokyo, Japan'],
    places: [
      { name: 'Hamarikyu Gardens', city: 'Tokyo', wikidata: 'Q1033333', coordinates: [35.660000, 139.762000] },
      { name: 'Rikugi Garden', city: 'Tokyo', wikidata: 'Q1889010', coordinates: [35.733056, 139.746667] },
      { name: 'Koishikawa Kōrakuen Garden', city: 'Tokyo', wikidata: 'Q1778881', coordinates: [35.705556, 139.749167] },
      { name: 'Kiyosumi Garden', city: 'Tokyo', wikidata: 'Q4388146', coordinates: [35.679944, 139.797722] },
      { name: 'Kyu Shiba Rikyu Garden', city: 'Tokyo', wikidata: 'Q3266874', coordinates: [35.655000, 139.759000] },
      { name: 'Inokashira Park', city: 'Tokyo', wikidata: 'Q1200884', coordinates: [35.698289, 139.571469] },
      { name: 'Nezu Shrine', city: 'Tokyo', wikidata: 'Q335612', coordinates: [35.720226, 139.760717] },
      { name: 'Hie Shrine', city: 'Tokyo', wikidata: 'Q702042', coordinates: [35.674722, 139.739583] },
      { name: 'Gōtoku-ji Temple', city: 'Tokyo', wikidata: 'Q11634381', coordinates: [35.648772, 139.647417] },
      { name: 'Shakujii Park', city: 'Tokyo', wikidata: 'Q4388784', coordinates: [35.738889, 139.597500] },
      { name: 'Meguro River', city: 'Tokyo', wikidata: 'Q8010297', coordinates: [35.621267, 139.729440] },
      { name: 'Sumida River', city: 'Tokyo', wikidata: 'Q222149', coordinates: [35.718611, 139.807222] },
      { name: 'Mount Takao', city: 'Tokyo', wikidata: 'Q1329959', coordinates: [35.625278, 139.243611] },
      { name: 'Kitanomaru Park', city: 'Tokyo', wikidata: 'Q1075966', coordinates: [35.691528, 139.751059] },
    ],
  },
  {
    key: 'kyoto',
    country: 'Japan',
    wikidata: 'Q34600',
    names: ['Kyoto', 'Kyoto, Japan'],
    places: [
      { name: 'Path of Philosophy', city: 'Kyoto', wikidata: 'Q1510488', coordinates: [35.025128, 135.796167] },
      { name: 'Kamo River', city: 'Kyoto', wikidata: 'Q27218', coordinates: [34.931417, 135.737236] },
      { name: 'Shimogamo Shrine', city: 'Kyoto', wikidata: 'Q701620', coordinates: [35.039069, 135.773012] },
      { name: 'Sanzen-in Temple', city: 'Kyoto', wikidata: 'Q1072538', coordinates: [35.119722, 135.834444] },
      { name: 'Kifune Shrine', city: 'Kyoto', wikidata: 'Q276779', coordinates: [35.121733, 135.762988] },
      { name: 'Takase River', city: 'Kyoto', wikidata: 'Q7677301', coordinates: [35.012300, 135.770000] },
      { name: 'Hōnen-in Temple', city: 'Kyoto', wikidata: 'Q11555257', coordinates: [35.023972, 135.797417] },
      { name: 'Nonomiya Shrine', city: 'Kyoto', wikidata: 'Q501266', coordinates: [35.017778, 135.674167] },
      { name: 'Shisen-dō Temple', city: 'Kyoto', wikidata: 'Q3028486', coordinates: [35.043744, 135.796241] },
      { name: 'Kurama-dera Temple', city: 'Kyoto', wikidata: 'Q608668', coordinates: [35.118061, 135.770742] },
      { name: 'Ninenzaka', city: 'Kyoto', wikidata: 'Q80622906', coordinates: [34.998593, 135.780812] },
      { name: 'Kyoto Gyoen National Garden', city: 'Kyoto', wikidata: 'Q843854', coordinates: [35.023289, 135.763306] },
      { name: 'Lake Biwa Canal', city: 'Kyoto', wikidata: 'Q2753954', coordinates: [35.011250, 135.855750] },
      { name: 'Arashiyama Bamboo Grove', city: 'Kyoto', wikidata: 'Q23579173', coordinates: [35.009465, 135.666772] },
    ],
  },
  {
    key: 'osaka',
    country: 'Japan',
    wikidata: 'Q35765',
    names: ['Osaka', 'Osaka, Japan'],
    places: [
      { name: 'Osaka Castle Park', city: 'Osaka', wikidata: 'Q150118', coordinates: [34.687378, 135.525844] },
      { name: 'Nakanoshima Park', city: 'Osaka', wikidata: 'Q6960289', coordinates: [34.693056, 135.506431] },
      { name: 'Keitaku-en', city: 'Osaka', wikidata: 'Q10855180', coordinates: [34.649667, 135.511528] },
      { name: 'Sumiyoshi Taisha', city: 'Osaka', wikidata: 'Q705949', coordinates: [34.612513, 135.492934] },
      { name: 'Utsubo Park', city: 'Osaka', wikidata: 'Q7903271', coordinates: [34.685100, 135.493000] },
      { name: 'Old Yodo River', city: 'Osaka', wikidata: 'Q5367937', coordinates: [34.658600, 135.431000] },
      { name: 'Shitennō-ji Temple', city: 'Osaka', wikidata: 'Q339859', coordinates: [34.653900, 135.516450] },
      { name: 'Hōzen-ji Temple', city: 'Osaka', wikidata: 'Q11555078', coordinates: [34.667858, 135.502628] },
      { name: 'Ōsaka Tenmangū', city: 'Osaka', wikidata: 'Q385793', coordinates: [34.696025, 135.512619] },
      { name: 'Nagai Botanical Garden', city: 'Osaka', wikidata: 'Q6149771', coordinates: [34.610556, 135.521667] },
      { name: 'Osaka Nanko Bird Sanctuary', city: 'Osaka', wikidata: 'Q11440090', coordinates: [34.634833, 135.399694] },
      { name: 'Tosabori River', city: 'Osaka', wikidata: 'Q20380122', coordinates: [34.684649, 135.481734] },
      { name: 'Kōrai Bridge', city: 'Osaka', wikidata: 'Q849402', coordinates: [34.689310, 135.509680] },
      { name: 'Tennōji Park', city: 'Osaka', wikidata: 'Q5364342', coordinates: [34.650000, 135.510000] },
    ],
  },
];

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
