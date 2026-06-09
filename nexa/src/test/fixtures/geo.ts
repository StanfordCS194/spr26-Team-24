import type { FeatureCollection, Polygon } from "geojson";

/**
 * A tiny GeoJSON FeatureCollection: one square polygon roughly around Palo
 * Alto. Coordinates are [lon, lat] per the spec. Use for point-in-polygon and
 * map-rendering tests without loading the full boundaries dataset.
 */
export const geoFeatureCollection: FeatureCollection<
  Polygon,
  { name: string }
> = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { name: "test-square" },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-122.2, 37.4],
            [-122.1, 37.4],
            [-122.1, 37.5],
            [-122.2, 37.5],
            [-122.2, 37.4],
          ],
        ],
      },
    },
  ],
};

/** A point clearly inside `geoFeatureCollection`'s square ([lon, lat]). */
export const pointInside: [number, number] = [-122.15, 37.45];

/** A point clearly outside the square ([lon, lat]). */
export const pointOutside: [number, number] = [-100.0, 40.0];
