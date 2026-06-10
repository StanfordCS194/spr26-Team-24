/**
 * Validate the bundled jurisdiction boundary GeoJSON.
 *
 *   npx tsx eval/validate-boundaries.ts
 *
 * Checks, in order:
 *   1. boundaries.json parses as a valid GeoJSON FeatureCollection of
 *      Polygon / MultiPolygon features with well-formed geometry.
 *   2. Every feature's `jurisdictionId` exists in the JURISDICTIONS registry
 *      (no silent drift between boundaries.json and registry.ts), every
 *      registry id is backed by at least one polygon, and every `priority`
 *      is a sane (finite, positive) number.
 *   3. Golden point-in-polygon assertions: a known interior point for each
 *      seeded jurisdiction resolves to the expected id via the REAL
 *      `resolveJurisdiction` (no reimplemented point-in-polygon).
 *
 * Runs fully OFFLINE over the bundled boundaries.json — no network, no LLM, no
 * database — so it is safe to run in CI without any API keys. Exits non-zero
 * when any check fails, so malformed or desynced boundary data fails the build.
 */
import type { Feature, FeatureCollection, Geometry, Position } from "geojson";

import boundaries from "../src/lib/jurisdictions/boundaries.json";
import { JURISDICTIONS } from "../src/lib/jurisdictions/registry";
import { resolveJurisdiction } from "../src/lib/jurisdictions/resolve";
import type { JurisdictionId } from "../src/lib/jurisdictions/types";

/**
 * Known-interior point for each seeded jurisdiction. These mirror the
 * non-contested cases in eval/dataset/routing-cases.json and must resolve to
 * the expected id; if a boundary is replaced with bad geometry, the matching
 * assertion here fails the build.
 */
const GOLDEN_POINTS: ReadonlyArray<{
  jurisdictionId: JurisdictionId;
  latitude: number;
  longitude: number;
}> = [
  {
    jurisdictionId: "stanford-campus",
    latitude: 37.42954,
    longitude: -122.17078,
  },
  {
    jurisdictionId: "city-palo-alto",
    latitude: 37.35109,
    longitude: -122.19389,
  },
  {
    jurisdictionId: "city-menlo-park",
    latitude: 37.44865,
    longitude: -122.17515,
  },
  {
    jurisdictionId: "city-mountain-view",
    latitude: 37.40154,
    longitude: -122.08137,
  },
  {
    jurisdictionId: "city-east-palo-alto",
    latitude: 37.45857,
    longitude: -122.13351,
  },
  {
    jurisdictionId: "county-santa-clara-unincorporated",
    latitude: 37.24497,
    longitude: -121.76879,
  },
];

const errors: string[] = [];
const fail = (msg: string) => errors.push(msg);

/** True for a [lon, lat] position with finite, in-range coordinates. */
function isValidPosition(pos: unknown): pos is Position {
  if (!Array.isArray(pos) || pos.length < 2) return false;
  const [lon, lat] = pos;
  return (
    typeof lon === "number" &&
    typeof lat === "number" &&
    Number.isFinite(lon) &&
    Number.isFinite(lat) &&
    lon >= -180 &&
    lon <= 180 &&
    lat >= -90 &&
    lat <= 90
  );
}

/** Validate a single linear ring: a closed array of >= 4 positions. */
function validateRing(ring: unknown, where: string): void {
  if (!Array.isArray(ring) || ring.length < 4) {
    fail(`${where}: linear ring must have at least 4 positions`);
    return;
  }
  for (let i = 0; i < ring.length; i++) {
    if (!isValidPosition(ring[i])) {
      fail(`${where}: position ${i} is not a valid [lon, lat] coordinate`);
      return;
    }
  }
}

/** Validate Polygon / MultiPolygon geometry shape. */
function validateGeometry(geometry: Geometry | null, where: string): void {
  if (!geometry || typeof geometry !== "object") {
    fail(`${where}: missing geometry`);
    return;
  }
  if (geometry.type === "Polygon") {
    if (
      !Array.isArray(geometry.coordinates) ||
      geometry.coordinates.length === 0
    ) {
      fail(`${where}: Polygon has no rings`);
      return;
    }
    geometry.coordinates.forEach((ring, i) =>
      validateRing(ring, `${where} ring[${i}]`),
    );
  } else if (geometry.type === "MultiPolygon") {
    if (
      !Array.isArray(geometry.coordinates) ||
      geometry.coordinates.length === 0
    ) {
      fail(`${where}: MultiPolygon has no polygons`);
      return;
    }
    geometry.coordinates.forEach((poly, p) => {
      if (!Array.isArray(poly) || poly.length === 0) {
        fail(`${where} polygon[${p}]: has no rings`);
        return;
      }
      poly.forEach((ring, i) =>
        validateRing(ring, `${where} polygon[${p}] ring[${i}]`),
      );
    });
  } else {
    fail(
      `${where}: geometry type "${geometry.type}" is not Polygon or MultiPolygon`,
    );
  }
}

// ---------------------------------------------------------------------------
// 1. GeoJSON structure
// ---------------------------------------------------------------------------
const fc = boundaries as unknown as FeatureCollection;

if (fc.type !== "FeatureCollection") {
  fail(`boundaries.json: type must be "FeatureCollection", got "${fc.type}"`);
}
if (!Array.isArray(fc.features) || fc.features.length === 0) {
  fail("boundaries.json: features must be a non-empty array");
}

const features: Feature[] = Array.isArray(fc.features) ? fc.features : [];

features.forEach((feature, i) => {
  const where = `feature[${i}]`;
  if (feature.type !== "Feature") {
    fail(`${where}: type must be "Feature", got "${feature.type}"`);
  }
  validateGeometry(feature.geometry, where);
});

// ---------------------------------------------------------------------------
// 2. Registry-id consistency + priority sanity
// ---------------------------------------------------------------------------
const registryIds = new Set(Object.keys(JURISDICTIONS));
const seenIds = new Set<string>();

features.forEach((feature, i) => {
  const where = `feature[${i}]`;
  const props = (feature.properties ?? {}) as {
    jurisdictionId?: unknown;
    priority?: unknown;
  };

  const id = props.jurisdictionId;
  if (typeof id !== "string" || id.length === 0) {
    fail(`${where}: missing jurisdictionId`);
  } else {
    if (!registryIds.has(id)) {
      fail(
        `${where}: jurisdictionId "${id}" is not in the JURISDICTIONS registry`,
      );
    }
    seenIds.add(id);
  }

  const priority = props.priority;
  if (
    typeof priority !== "number" ||
    !Number.isFinite(priority) ||
    priority <= 0
  ) {
    fail(
      `${where} (${String(id)}): priority must be a positive finite number, got ${String(
        priority,
      )}`,
    );
  }
});

// Every registry entry must be backed by at least one polygon, otherwise the
// resolver can never return it and coverage claims are unaudited.
for (const id of registryIds) {
  if (!seenIds.has(id)) {
    fail(`registry id "${id}" has no boundary feature in boundaries.json`);
  }
}

// ---------------------------------------------------------------------------
// 3. Golden point-in-polygon assertions (reuse the real resolver)
// ---------------------------------------------------------------------------
for (const golden of GOLDEN_POINTS) {
  const match = resolveJurisdiction(golden.latitude, golden.longitude, "other");
  if (!match) {
    fail(
      `golden point (${golden.latitude}, ${golden.longitude}) resolved to no jurisdiction; expected "${golden.jurisdictionId}"`,
    );
  } else if (match.jurisdiction.id !== golden.jurisdictionId) {
    fail(
      `golden point (${golden.latitude}, ${golden.longitude}) resolved to "${match.jurisdiction.id}"; expected "${golden.jurisdictionId}"`,
    );
  }
}

// Every seeded jurisdiction must have a golden point so new ids cannot land
// without a point-in-polygon assertion guarding them.
const goldenIds = new Set(GOLDEN_POINTS.map((g) => g.jurisdictionId));
for (const id of registryIds) {
  if (!goldenIds.has(id as JurisdictionId)) {
    fail(`registry id "${id}" has no golden point-in-polygon assertion`);
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
if (errors.length > 0) {
  console.error(
    `\nFAIL: ${errors.length} boundary validation error(s):\n` +
      errors.map((e) => `  - ${e}`).join("\n"),
  );
  process.exit(1);
}

console.log(
  `PASS: ${features.length} boundary feature(s) validated — GeoJSON well-formed, ` +
    `all jurisdictionIds in registry, priorities sane, ` +
    `${GOLDEN_POINTS.length} golden point-in-polygon assertions resolved correctly.`,
);
