import { describe, expect, it } from "vitest";

import { prismaMock } from "@/test/prisma-mock";

import { resolveAgencyId } from "./agency";
import { resolveJurisdiction } from "./resolve";

// End-to-end location → agency routing (issue #218 scope (c)). These tests prove
// the coordinates a report carries (from a GPS share, an address pick, or photo
// EXIF — the source is irrelevant once we hold a lat/lon) drive the polygon
// router and the agency lookup to the EXPECTED agency.
//
// `resolveJurisdiction` is a pure function over the committed boundaries.json, so
// it runs for real and offline. `resolveAgencyId` then hits prisma.agency, which
// the shared deep-mock (`@/test/prisma-mock`) intercepts — we stub the rows the
// seeded DB would return and assert both the QUERY (correct jurisdiction filter)
// and the RESULT (the one confident agency id).
//
// Coordinates are reused from resolve.test.ts so the two suites stay in lockstep:
//   PALO_ALTO -> city-palo-alto
//   EAST_PALO_ALTO -> city-east-palo-alto
const PALO_ALTO = { latitude: 37.4419, longitude: -122.143 } as const;
const EAST_PALO_ALTO = { latitude: 37.4688, longitude: -122.1411 } as const;

type AgencyRow = Awaited<ReturnType<typeof prismaMock.agency.findMany>>;

describe("location → agency routing", () => {
  it("a Palo Alto coordinate resolves to the Palo Alto jurisdiction", () => {
    // Act
    const match = resolveJurisdiction(
      PALO_ALTO.latitude,
      PALO_ALTO.longitude,
      "ROAD_DAMAGE",
    );

    // Assert
    expect(match?.jurisdiction.id).toBe("city-palo-alto");
  });

  it("a Palo Alto coordinate routes to the Palo Alto agency", async () => {
    // Arrange: the seeded DB has exactly one Palo Alto agency covering the issue.
    prismaMock.agency.findMany.mockResolvedValue([
      { id: "agency-palo-alto" },
    ] as AgencyRow);

    // Act
    const result = await resolveAgencyId({
      ...PALO_ALTO,
      issueType: "ROAD_DAMAGE",
    });

    // Assert: the lookup was scoped to the resolved jurisdiction + issue type...
    expect(prismaMock.agency.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          jurisdiction: "city-palo-alto",
          issueTypes: { has: "ROAD_DAMAGE" },
        },
      }),
    );
    // ...and the single covering agency became the confident match.
    expect(result.agencyId).toBe("agency-palo-alto");
    expect(result.candidates).toEqual(["agency-palo-alto"]);
  });

  it("an East Palo Alto coordinate resolves to the East Palo Alto jurisdiction", () => {
    // Act
    const match = resolveJurisdiction(
      EAST_PALO_ALTO.latitude,
      EAST_PALO_ALTO.longitude,
      "ROAD_DAMAGE",
    );

    // Assert
    expect(match?.jurisdiction.id).toBe("city-east-palo-alto");
  });

  it("an East Palo Alto coordinate routes to the East Palo Alto agency", async () => {
    // Arrange
    prismaMock.agency.findMany.mockResolvedValue([
      { id: "agency-east-palo-alto" },
    ] as AgencyRow);

    // Act
    const result = await resolveAgencyId({
      ...EAST_PALO_ALTO,
      issueType: "ROAD_DAMAGE",
    });

    // Assert: routed to the EPA jurisdiction, not Palo Alto's.
    expect(prismaMock.agency.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          jurisdiction: "city-east-palo-alto",
          issueTypes: { has: "ROAD_DAMAGE" },
        },
      }),
    );
    expect(result.agencyId).toBe("agency-east-palo-alto");
  });

  it("the two neighboring points route to DIFFERENT agencies", async () => {
    // Arrange: Palo Alto and East Palo Alto are adjacent but distinct cities.
    // The same issue type must not collapse them onto one agency.
    prismaMock.agency.findMany
      .mockResolvedValueOnce([{ id: "agency-palo-alto" }] as AgencyRow)
      .mockResolvedValueOnce([{ id: "agency-east-palo-alto" }] as AgencyRow);

    // Act
    const pa = await resolveAgencyId({
      ...PALO_ALTO,
      issueType: "ROAD_DAMAGE",
    });
    const epa = await resolveAgencyId({
      ...EAST_PALO_ALTO,
      issueType: "ROAD_DAMAGE",
    });

    // Assert
    expect(pa.agencyId).toBe("agency-palo-alto");
    expect(epa.agencyId).toBe("agency-east-palo-alto");
    expect(pa.agencyId).not.toBe(epa.agencyId);
  });

  it("returns no agency for a point outside every jurisdiction", async () => {
    // Arrange: middle of the ocean — no polygon matches, so prisma is never hit.
    // Act
    const result = await resolveAgencyId({
      latitude: 0,
      longitude: 0,
      issueType: "ROAD_DAMAGE",
    });

    // Assert
    expect(result).toEqual({ agencyId: null, candidates: [] });
    expect(prismaMock.agency.findMany).not.toHaveBeenCalled();
  });

  it("surfaces both candidates without auto-assigning when the match is ambiguous", async () => {
    // Arrange: a real spot inside Palo Alto, but two agencies cover the issue.
    prismaMock.agency.findMany.mockResolvedValue([
      { id: "agency-palo-alto-web" },
      { id: "agency-palo-alto-api" },
    ] as AgencyRow);

    // Act
    const result = await resolveAgencyId({
      ...PALO_ALTO,
      issueType: "ROAD_DAMAGE",
    });

    // Assert: ambiguity is left for a later disambiguation step — no auto-pick.
    expect(result.agencyId).toBeNull();
    expect(result.candidates).toEqual([
      "agency-palo-alto-web",
      "agency-palo-alto-api",
    ]);
  });

  it("returns no agency when coordinates are missing even with an issue type", async () => {
    // Act: a free-text address that never resolved to a point.
    const result = await resolveAgencyId({
      latitude: null,
      longitude: null,
      issueType: "ROAD_DAMAGE",
    });

    // Assert: short-circuits before any polygon/DB work.
    expect(result).toEqual({ agencyId: null, candidates: [] });
    expect(prismaMock.agency.findMany).not.toHaveBeenCalled();
  });
});
