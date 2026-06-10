import { describe, expect, it } from "vitest";

import { prismaMock } from "@/test/prisma-mock";

import { resolveAgencyCandidates } from "./agency";

// Menlo Park (Santa Cruz Ave area) — a point inside the city-menlo-park polygon,
// where two agencies (web-form + Open311) both cover ROAD_DAMAGE. This is the
// canonical ambiguity the disambiguation flow unblocks.
const MENLO_PARK = { latitude: 37.4524, longitude: -122.1817 } as const;

type AgencyRow = Awaited<ReturnType<typeof prismaMock.agency.findMany>>;

describe("resolveAgencyCandidates", () => {
  it("hydrates candidate details and asks a question when ambiguous", async () => {
    // Arrange: two agencies share the jurisdiction. resolveAgencyId selects them
    // (first findMany), then resolveAgencyCandidates hydrates them (second
    // findMany). Both calls hit prisma.agency.findMany, so stub it to return the
    // id-only shape first and the detail shape second.
    prismaMock.agency.findMany
      .mockResolvedValueOnce([
        { id: "agency-act" },
        { id: "agency-open311" },
      ] as AgencyRow)
      .mockResolvedValueOnce([
        {
          id: "agency-act",
          name: "Menlo Park ACT",
          jurisdiction: "city-menlo-park",
          intakeMethod: "WEB_FORM",
        },
        {
          id: "agency-open311",
          name: "Menlo Park SeeClickFix (Open311)",
          jurisdiction: "city-menlo-park",
          intakeMethod: "API",
        },
      ] as AgencyRow);

    // Act
    const result = await resolveAgencyCandidates({
      ...MENLO_PARK,
      issueType: "ROAD_DAMAGE",
    });

    // Assert: ambiguous — no single agencyId, both candidates surfaced with
    // displayable detail, and a disambiguating question to ask the user.
    expect(result.agencyId).toBeNull();
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates.map((c) => c.id)).toEqual([
      "agency-act",
      "agency-open311",
    ]);
    expect(result.candidates[1]).toMatchObject({
      name: "Menlo Park SeeClickFix (Open311)",
      intakeMethod: "API",
    });
    expect(result.disambiguation).toBeTruthy();
  });

  it("returns a single confident candidate with no question (no regression)", async () => {
    // Arrange: exactly one agency covers the spot -> confident match.
    prismaMock.agency.findMany
      .mockResolvedValueOnce([{ id: "agency-act" }] as AgencyRow)
      .mockResolvedValueOnce([
        {
          id: "agency-act",
          name: "Menlo Park ACT",
          jurisdiction: "city-menlo-park",
          intakeMethod: "WEB_FORM",
        },
      ] as AgencyRow);

    // Act
    const result = await resolveAgencyCandidates({
      ...MENLO_PARK,
      issueType: "ROAD_DAMAGE",
    });

    // Assert: confident single match, no prompt.
    expect(result.agencyId).toBe("agency-act");
    expect(result.candidates).toHaveLength(1);
    expect(result.disambiguation).toBeNull();
  });

  it("returns empty/null when nothing covers the location + issue type", async () => {
    // Arrange: polygon matches but no agency covers it.
    prismaMock.agency.findMany.mockResolvedValue([] as AgencyRow);

    // Act
    const result = await resolveAgencyCandidates({
      ...MENLO_PARK,
      issueType: "ROAD_DAMAGE",
    });

    // Assert
    expect(result).toEqual({
      agencyId: null,
      candidates: [],
      disambiguation: null,
    });
  });
});
