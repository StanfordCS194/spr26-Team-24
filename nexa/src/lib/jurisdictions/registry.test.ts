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

  it("returns the verified East Palo Alto road-damage portal (issue #195)", () => {
    // Arrange / Act: EPA now has an issue-type-specific ROAD_DAMAGE intake.
    const portal = getPortal("city-east-palo-alto", "ROAD_DAMAGE");

    // Assert: resolves to the verified EPA Public Works contact form.
    expect(portal).toEqual(
      JURISDICTIONS["city-east-palo-alto"].endpoints.ROAD_DAMAGE,
    );
    expect(portal?.url).toContain("cityofepa.org");
  });

  it("falls back to null for an East Palo Alto issue type with no verified intake", () => {
    // Arrange / Act: EPA's `default` is null, so an issue type without a
    // specific entry (e.g. STREETLIGHT_OUTAGE) still resolves to null and the
    // caller falls through to the LLM lookup.
    const portal = getPortal("city-east-palo-alto", "STREETLIGHT_OUTAGE");

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
