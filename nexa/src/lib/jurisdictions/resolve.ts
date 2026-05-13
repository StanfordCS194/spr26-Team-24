import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import { point } from "@turf/helpers";
import type { Feature, Polygon, MultiPolygon } from "geojson";

import boundaries from "./boundaries.json";
import { JURISDICTIONS, getPortal } from "./registry";
import type {
  Jurisdiction,
  JurisdictionId,
  JurisdictionMatch,
} from "./types";

type BoundaryProps = {
  jurisdictionId: JurisdictionId;
  priority: number;
};

type BoundaryFeature = Feature<Polygon | MultiPolygon, BoundaryProps>;

const FEATURES: BoundaryFeature[] = (
  boundaries as { features: BoundaryFeature[] }
).features
  .slice()
  .sort((a, b) => a.properties.priority - b.properties.priority);

/**
 * Tests a lat/lon against the registered jurisdiction polygons in priority
 * order (most specific first). Returns the first hit, or null if none match.
 */
export function resolveJurisdiction(
  latitude: number,
  longitude: number,
  issueType: string,
): JurisdictionMatch | null {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  const pt = point([longitude, latitude]);

  for (const feature of FEATURES) {
    if (booleanPointInPolygon(pt, feature)) {
      const jurisdiction: Jurisdiction | undefined =
        JURISDICTIONS[feature.properties.jurisdictionId];
      if (!jurisdiction) continue;
      return {
        jurisdiction,
        portal: getPortal(feature.properties.jurisdictionId, issueType),
      };
    }
  }

  return null;
}
