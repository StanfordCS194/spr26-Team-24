import { describe, expect, it } from "vitest";

import { getPortal, JURISDICTIONS } from "./registry";
import type { JurisdictionId } from "./types";

// getPortal is a pure data lookup over the static JURISDICTIONS registry.
describe("getPortal", () => {
  it("returns the default endpoint when no issue-specific entry exists", () => {
    // Arrange / Act: Palo Alto only defines a `default` endpoint.
    const portal = getPortal("city-palo-alto", "ROAD_DAMAGE");

    // Assert
    expect(portal).toEqual(JURISDICTIONS["city-palo-alto"].endpoints.default);
    expect(portal?.url).toContain("paloalto.gov");
  });

  it("returns null when the matched jurisdiction's default endpoint is null", () => {
    // Arrange / Act: East Palo Alto has an unverified (null) default portal.
    const portal = getPortal("city-east-palo-alto", "ROAD_DAMAGE");

    // Assert
    expect(portal).toBeNull();
  });

  it("returns null for an unknown jurisdiction id", () => {
    // Arrange / Act
    const portal = getPortal("nope" as JurisdictionId, "ROAD_DAMAGE");

    // Assert
    expect(portal).toBeNull();
  });

  it("ignores the issue type when only a default endpoint is configured", () => {
    // Arrange / Act: an arbitrary issue type still resolves to the default.
    const portal = getPortal("city-menlo-park", "STREETLIGHT_OUTAGE");

    // Assert
    expect(portal).toEqual(JURISDICTIONS["city-menlo-park"].endpoints.default);
  });
});
