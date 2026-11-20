# Wikidata candidates for the real-place lists (V2-04)

Raw SPARQL results from https://query.wikidata.org/sparql, fetched 2026-11-18. The places in
`src/realPlaces.ts` were picked from these files, so the choice can be checked against them.

| File | What it holds |
|------|---------------|
| `destinations.json` | Q17 (Japan), Q1490 (Tokyo), Q34600 (Kyoto), Q35765 (Osaka): label, class, country, coordinates |
| `tokyo.json` | Items located in (P131, transitive) Q1490 with coordinates, an English label and at least 8 sitelinks, cities excluded |
| `kyoto.json` | The same for Q34600, at least 6 sitelinks |
| `osaka.json` | The same for Q35765, at least 5 sitelinks |
| `osaka-extended.json` | Q35765 again with 2 to 4 sitelinks, because the first Osaka pass was thin |
| `japan.json` | Items directly in Nara, Hakone, Kanazawa, Nikkō, Hatsukaichi, Kamakura, Takayama, Shirakawa, Kurashiki, Matsumoto, Uji, Fujikawaguchiko, Kawagoe, Hakodate, Otaru, Ise, Himeji, Hiroshima, Nagasaki and Matsushima (cities, towns and designated cities of Japan), at least 4 sitelinks |
| `japan-extra.json` | Items directly in a few more municipalities by name (Kanazawa, Nikkō, Takayama, Kurashiki, Matsumoto, Kawagoe, Otaru, Hagi, Tsuwano, Yoshino, Kotohira, Kōya), at least 4 sitelinks |

Each row has the item, its English label, coordinates, sitelink count, class labels and English
aliases. A nationwide query (P17 = Q17, at least 15 sitelinks) timed out, so the Japan list was
drawn from the named municipalities instead.

The city query, as run for Tokyo:

```sparql
SELECT ?item ?label ?coord ?sitelinks (GROUP_CONCAT(DISTINCT ?instLabel; separator="|") AS ?classes) (GROUP_CONCAT(DISTINCT ?alias; separator="|") AS ?aliases) WHERE {
  ?item wdt:P131+ wd:Q1490 ; wdt:P625 ?coord ; wikibase:sitelinks ?sitelinks ; rdfs:label ?label .
  FILTER(LANG(?label) = "en") FILTER(?sitelinks >= 8)
  ?item wdt:P31 ?inst . ?inst rdfs:label ?instLabel . FILTER(LANG(?instLabel) = "en")
  OPTIONAL { ?item skos:altLabel ?alias . FILTER(LANG(?alias) = "en") }
  FILTER NOT EXISTS { ?item wdt:P31/wdt:P279* wd:Q515 }
} GROUP BY ?item ?label ?coord ?sitelinks ORDER BY DESC(?sitelinks)
```

Where an item has more than one P625 value (Sumida River, Kamo River), the list uses the first
one, because that is the value `npm run check:places` compares against.
