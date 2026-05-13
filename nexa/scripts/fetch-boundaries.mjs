#!/usr/bin/env node
/**
 * Pulls jurisdiction polygons from OpenStreetMap (Nominatim) and writes them
 * to src/lib/jurisdictions/boundaries.geojson.
 *
 * Re-run when adding a jurisdiction or when an upstream boundary changes.
 * Nominatim allows ~1 req/sec with a real User-Agent — we sleep 1100ms between
 * calls. https://operations.osmfoundation.org/policies/nominatim/
 *
 * Usage: node scripts/fetch-boundaries.mjs
 */

import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT = resolve(
  __dirname,
  "..",
  "src",
  "lib",
  "jurisdictions",
  "boundaries.json",
);

const USER_AGENT = "Nexa boundary fetcher (https://github.com/StanfordCS194)";

// Source of truth for which polygons we fetch. Lower `priority` = more specific
// = tested first. Stanford must beat Palo Alto, which must beat the county.
const SOURCES = [
  {
    jurisdictionId: "stanford-campus",
    name: "Stanford University",
    priority: 10,
    query: "Stanford University, Stanford, California, USA",
    preferType: "way",
  },
  {
    jurisdictionId: "city-palo-alto",
    name: "Palo Alto",
    priority: 50,
    query: "Palo Alto, Santa Clara County, California, USA",
    preferType: "relation",
  },
  {
    jurisdictionId: "city-menlo-park",
    name: "Menlo Park",
    priority: 50,
    query: "Menlo Park, San Mateo County, California, USA",
    preferType: "relation",
  },
  {
    jurisdictionId: "city-mountain-view",
    name: "Mountain View",
    priority: 50,
    query: "Mountain View, Santa Clara County, California, USA",
    preferType: "relation",
  },
  {
    jurisdictionId: "city-east-palo-alto",
    name: "East Palo Alto",
    priority: 50,
    query: "East Palo Alto, San Mateo County, California, USA",
    preferType: "relation",
  },
  // Coarse county-wide fallback. Anything inside SCC that didn't match a more
  // specific polygon above falls through to the unincorporated-SCC entry.
  {
    jurisdictionId: "county-santa-clara-unincorporated",
    name: "Santa Clara County (unincorporated fallback)",
    priority: 900,
    query: "Santa Clara County, California, USA",
    preferType: "relation",
  },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchPolygon(source) {
  const params = new URLSearchParams({
    q: source.query,
    format: "jsonv2",
    polygon_geojson: "1",
    limit: "10",
  });
  const url = `https://nominatim.openstreetmap.org/search?${params.toString()}`;

  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) {
    throw new Error(`Nominatim ${res.status} for ${source.jurisdictionId}`);
  }
  const results = await res.json();

  const match =
    results.find(
      (r) =>
        r.osm_type === source.preferType &&
        (r.geojson?.type === "Polygon" || r.geojson?.type === "MultiPolygon"),
    ) ??
    results.find(
      (r) => r.geojson?.type === "Polygon" || r.geojson?.type === "MultiPolygon",
    );

  if (!match) {
    throw new Error(
      `No polygon result for "${source.query}" (${source.jurisdictionId})`,
    );
  }

  return {
    type: "Feature",
    properties: {
      jurisdictionId: source.jurisdictionId,
      name: source.name,
      priority: source.priority,
      osmType: match.osm_type,
      osmId: match.osm_id,
      sourceQuery: source.query,
      fetchedAt: new Date().toISOString(),
    },
    geometry: match.geojson,
  };
}

async function main() {
  const features = [];
  for (const source of SOURCES) {
    process.stdout.write(`Fetching ${source.jurisdictionId}... `);
    try {
      const feature = await fetchPolygon(source);
      features.push(feature);
      console.log(`ok (osm ${feature.properties.osmType}/${feature.properties.osmId})`);
    } catch (err) {
      console.log(`FAILED: ${err.message}`);
      throw err;
    }
    await sleep(1100);
  }

  const collection = { type: "FeatureCollection", features };
  await writeFile(OUTPUT, JSON.stringify(collection, null, 2) + "\n");
  console.log(`\nWrote ${features.length} features to ${OUTPUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
