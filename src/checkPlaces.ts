/**
 * Vision Frames v2 - Real-place check (development tool)
 *
 * Confirms every place on the destination lists against the live Wikidata API (V2-04):
 *
 *   npm run check:places
 *
 * Needs network access to www.wikidata.org. Prints one line per problem and exits 1 if
 * there are any; a list does not ship until this passes and the owner has approved it.
 */

import { EntityFetcher, WikidataEntity, checkDestinations } from './placeCheck';
import { REAL_PLACE_DESTINATIONS } from './realPlaces';

const USER_AGENT = 'vision-frames-engine place check (https://github.com/ramontelongo22/vision-frames-engine)';

const fetchEntity: EntityFetcher = async (id) => {
  const response = await fetch(`https://www.wikidata.org/wiki/Special:EntityData/${id}.json`, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
  });
  if (response.status === 404) {
    return undefined;
  }
  if (!response.ok) {
    throw new Error(`Wikidata returned HTTP ${response.status} for ${id}`);
  }
  const body = (await response.json()) as { entities?: Record<string, WikidataEntity> };
  // A merged item answers with the item it was merged into
  return Object.values(body.entities ?? {})[0];
};

async function main(): Promise<number> {
  const places = REAL_PLACE_DESTINATIONS.reduce((sum, destination) => sum + destination.places.length, 0);
  const problems = await checkDestinations(REAL_PLACE_DESTINATIONS, fetchEntity);
  for (const { destination, wikidata, problem } of problems) {
    console.log(`${destination} ${wikidata}: ${problem}`);
  }
  console.log(`${REAL_PLACE_DESTINATIONS.length} destinations, ${places} places, ${problems.length} problems`);
  return problems.length === 0 ? 0 : 1;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
);
