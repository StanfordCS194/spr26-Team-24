import { describe, expect, it } from "vitest";

import { resolveJurisdiction } from "./resolve";

// Unit test (node project): a real exported pure function, no mocks needed.
// Coordinates below were chosen against the committed boundaries.json so the
// tests are deterministic and offline.
describe("resolveJurisdiction", () => {
  it("returns null for NaN coordinates", () => {
    // Arrange / Act
    const result = resolveJurisdiction(Number.NaN, -122.17, "ROAD_DAMAGE");

    // Assert
    expect(result).toBeNull();
  });

  it("returns null for Infinity coordinates", () => {
    // Arrange / Act
    const result = resolveJurisdiction(
      37.4275,
      Number.POSITIVE_INFINITY,
      "ROAD_DAMAGE",
    );

    // Assert
    expect(result).toBeNull();
  });

  it("returns null for a point far outside every jurisdiction", () => {
    // Arrange: middle of the Atlantic Ocean.
    // Act
    const result = resolveJurisdiction(0, 0, "ROAD_DAMAGE");

    // Assert
    expect(result).toBeNull();
  });

  it("resolves a point inside the Stanford campus boundary", () => {
    // Arrange: a coordinate inside the Stanford-campus polygon.
    // Act
    const result = resolveJurisdiction(37.4275, -122.17, "ROAD_DAMAGE");

    // Assert
    expect(result).not.toBeNull();
    expect(result?.jurisdiction.id).toBe("stanford-campus");
  });

  it("prefers the higher-priority (lower number) polygon when polygons overlap", () => {
    // Arrange: the Stanford point also falls within the county fallback
    // polygon (priority 900); priority ordering must pick Stanford (10).
    // Act
    const result = resolveJurisdiction(37.4275, -122.17, "ROAD_DAMAGE");

    // Assert
    expect(result?.jurisdiction.id).toBe("stanford-campus");
  });

  it("attaches the resolved portal for a city with a verified endpoint", () => {
    // Arrange: a point inside the Palo Alto city boundary.
    // Act
    const result = resolveJurisdiction(37.4419, -122.143, "ROAD_DAMAGE");

    // Assert
    expect(result?.jurisdiction.id).toBe("city-palo-alto");
    expect(result?.portal?.url).toContain("paloalto.gov");
  });

  it("returns a null portal when the matched jurisdiction has no verified endpoint for the issue type", () => {
    // Arrange: East Palo Alto matches a polygon and now has verified
    // ROAD_DAMAGE / ILLEGAL_DUMPING intakes (issue #195), but no STREETLIGHT
    // intake — that issue type falls through to its null `default`.
    // Act
    const result = resolveJurisdiction(
      37.4688,
      -122.1411,
      "STREETLIGHT_OUTAGE",
    );

    // Assert
    expect(result?.jurisdiction.id).toBe("city-east-palo-alto");
    expect(result?.portal).toBeNull();
  });
});
