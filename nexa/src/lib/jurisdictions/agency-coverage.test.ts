import { describe, expect, it } from "vitest";

import { AGENCIES } from "../../../prisma/agencies";
import { countTriples } from "../../../eval/coverage";

// These tests lock the seeded agency data and the O2.KR2 coverage count so the
// verified East Palo Alto rows (issue #195) and the distinct-triple total
// (issue #198) can never silently regress.

describe("seeded agency coverage (issues #195 / #198)", () => {
  it("seeds the verified East Palo Alto Public Works (ROAD_DAMAGE, web form)", () => {
    const epaRoads = AGENCIES.find(
      (a) => a.name === "East Palo Alto Public Works",
    );
    expect(epaRoads).toBeDefined();
    expect(epaRoads?.jurisdiction).toBe("city-east-palo-alto");
    // EPA Public Works still owns ROAD_DAMAGE; the taxonomy-routing expansion
    // (#264) widened it to the general-civic types it plausibly handles, but
    // illegal dumping remains with the dedicated EPA Clean City row.
    expect(epaRoads?.issueTypes).toContain("ROAD_DAMAGE");
    expect(epaRoads?.issueTypes).not.toContain("ILLEGAL_DUMPING");
    expect(epaRoads?.intakeMethod).toBe("WEB_FORM");
    // Verified intake URL + staff-email fallback (issue #23 research).
    expect(epaRoads?.intakeUrl).toContain("cityofepa.org");
    expect(epaRoads?.intakeEmail).toBe("maintenance@cityofepa.org");
  });

  it("seeds the verified East Palo Alto Clean City (ILLEGAL_DUMPING, email + hotline)", () => {
    const epaDump = AGENCIES.find(
      (a) => a.name === "East Palo Alto Clean City",
    );
    expect(epaDump).toBeDefined();
    expect(epaDump?.jurisdiction).toBe("city-east-palo-alto");
    expect(epaDump?.issueTypes).toEqual(["ILLEGAL_DUMPING"]);
    expect(epaDump?.intakeMethod).toBe("EMAIL");
    expect(epaDump?.intakeEmail).toBe("cleancity@cityofepa.org");
    // The verified (650) 853-3100 hotline is carried as an embedded field value.
    const fields = epaDump?.requiredFields as {
      contact_phone?: { value?: string };
    };
    expect(fields?.contact_phone?.value).toBe("(650) 853-3100");
  });

  it("now covers East Palo Alto so it no longer resolves to no_agency (issue #195)", () => {
    const epaAgencies = AGENCIES.filter(
      (a) => a.jurisdiction === "city-east-palo-alto",
    );
    // At least the two P0 categories (road damage + illegal dumping) are covered.
    expect(epaAgencies.length).toBeGreaterThanOrEqual(2);
    const covered = new Set(epaAgencies.flatMap((a) => a.issueTypes));
    expect(covered.has("ROAD_DAMAGE")).toBe(true);
    expect(covered.has("ILLEGAL_DUMPING")).toBe(true);
  });

  it("counts the distinct (jurisdiction × issueType × intakeMethod) triples (O2.KR2)", () => {
    const { total, jurisdictions, intakeMethods } = countTriples();

    // HONEST count: the verified seed now yields 153 distinct triples. The
    // taxonomy-routing expansion (#264) wired the 13 new IssueType values to
    // each agency that handles them — adding live-verified SeeClickFix service
    // codes per city for the seven Open311 API agencies, and widening the
    // general WEB_FORM/EMAIL intakes (Palo Alto 311, Mountain View, Santa Clara
    // County, EPA Public Works, Menlo Park ACT) to the new general-civic types
    // they plausibly handle. This is on top of the earlier 34 (six SeeClickFix
    // cities + East Palo Alto). This assertion is the regression lock; raise it
    // (never lower it) only when MORE source-verified triples are added. We do
    // NOT fabricate agencies/fields to inflate it.
    expect(total).toBe(153);
    expect(total).toBeGreaterThanOrEqual(30);

    // Across >=2 jurisdictions, with all four intake methods represented.
    expect(jurisdictions.length).toBeGreaterThanOrEqual(2);
    expect(jurisdictions).toContain("city-east-palo-alto");
    expect(jurisdictions).toContain("city-milpitas");
    expect(intakeMethods).toEqual(["API", "EMAIL", "PHONE", "WEB_FORM"]);
  });
});
