import { describe, expect, it } from "vitest";

import { resolveJurisdiction } from "./resolve";

// Unit test (node project): a real exported pure function, no mocks needed.
describe("resolveJurisdiction", () => {
  it("returns null for non-finite coordinates", () => {
    // Arrange / Act
    const result = resolveJurisdiction(Number.NaN, -122.17, "ROAD_DAMAGE");

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
});
