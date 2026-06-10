/**
 * Agency coverage audit (O2.KR2).
 *
 *   npx tsx eval/coverage.ts
 *   npm run eval:coverage
 *   npm run eval:coverage -- --strict   # exit non-zero when below the target
 *
 * WHAT IT MEASURES (O2.KR2): the number of DISTINCT
 * `(jurisdiction, issueType, intakeMethod)` triples the seeded agencies cover.
 * The OKR target is >=30 such triples across >=2 jurisdictions, each with a
 * known submission method. This script is the single source of truth for that
 * count — it enumerates every triple straight from the same `AGENCIES` array
 * that `prisma/seed.ts` writes to the DB and `eval/readiness.ts` routes against,
 * so there is no parallel data structure to drift.
 *
 * FULLY OFFLINE: it only imports the static seed array. No network, DB, or LLM.
 *
 * HONESTY POLICY: this script reports the REAL verified count. After the East
 * Palo Alto + verified-coverage expansion (issues #195/#198) the seed yielded 16
 * distinct triples — short of the 30 target. The O2.KR2 coverage expansion then
 * onboarded six source-verified SeeClickFix Open311 California cities (Milpitas,
 * Morgan Hill, Gilroy, Watsonville, Vallejo, San Leandro), each verified live
 * against the SeeClickFix Open311 API (services.json HTTP 200 with the city's own
 * `organization`, every chosen service_code re-confirmed via services/<code>.json
 * HTTP 200) and each backed by a real OSM city-boundary polygon — bringing the
 * total to 34 distinct triples across 11 jurisdictions. The taxonomy-routing
 * expansion (#264) then wired the 13 new IssueType values to every agency that
 * handles them (live-verified SeeClickFix service codes per city, plus widening
 * the general WEB_FORM/EMAIL intakes to the new general-civic types), bringing
 * the verified total to 153 distinct triples — clearing the 30 target WITHOUT
 * inventing any agency, service_code, or field. By default the script exits 0 (it
 * is a documentation/visibility tool); pass `--strict` to make it exit non-zero
 * if the verified data ever regresses below the target.
 */
import { AGENCIES } from "../prisma/agencies";

/** O2.KR2 target: >=30 distinct (jurisdiction, issueType, intakeMethod) triples. */
const TARGET_TRIPLES = 30;

interface Triple {
  jurisdiction: string;
  issueType: string;
  intakeMethod: string;
}

function enumerateTriples(): Triple[] {
  const seen = new Set<string>();
  const triples: Triple[] = [];
  for (const agency of AGENCIES) {
    for (const issueType of agency.issueTypes) {
      const key = `${agency.jurisdiction}|${issueType}|${agency.intakeMethod}`;
      if (seen.has(key)) continue;
      seen.add(key);
      triples.push({
        jurisdiction: agency.jurisdiction,
        issueType,
        intakeMethod: agency.intakeMethod,
      });
    }
  }
  return triples;
}

/**
 * Counts distinct (jurisdiction, issueType, intakeMethod) triples and the
 * supporting jurisdiction / intake-method breakdowns. Exported so unit tests can
 * assert the count without re-implementing the enumeration.
 */
export function countTriples(): {
  total: number;
  triples: Triple[];
  jurisdictions: string[];
  intakeMethods: string[];
} {
  const triples = enumerateTriples();
  const jurisdictions = Array.from(
    new Set(triples.map((t) => t.jurisdiction)),
  ).sort();
  const intakeMethods = Array.from(
    new Set(triples.map((t) => t.intakeMethod)),
  ).sort();
  return { total: triples.length, triples, jurisdictions, intakeMethods };
}

function main(): void {
  const strict = process.argv.slice(2).includes("--strict");
  const { total, triples, jurisdictions, intakeMethods } = countTriples();

  console.log("\n=== Agency coverage audit (O2.KR2) ===");
  console.log(
    `Distinct (jurisdiction × issueType × intakeMethod) triples: ${total}  (target >=${TARGET_TRIPLES})`,
  );
  console.log(
    `Jurisdictions covered: ${jurisdictions.length} — ${jurisdictions.join(", ")}`,
  );
  console.log(`Intake methods present: ${intakeMethods.join(", ")}`);

  console.log("\nTriples:");
  for (const t of triples
    .slice()
    .sort((a, b) =>
      `${a.jurisdiction}|${a.issueType}|${a.intakeMethod}`.localeCompare(
        `${b.jurisdiction}|${b.issueType}|${b.intakeMethod}`,
      ),
    )) {
    console.log(`  ${t.jurisdiction} | ${t.issueType} | ${t.intakeMethod}`);
  }

  const meetsTarget = total >= TARGET_TRIPLES;
  if (meetsTarget) {
    console.log(
      `\nPASS: ${total}/${TARGET_TRIPLES} verified triples across ${jurisdictions.length} jurisdictions (O2.KR2 met).`,
    );
  } else {
    const gap = TARGET_TRIPLES - total;
    console.log(
      `\nBELOW TARGET: ${total}/${TARGET_TRIPLES} verified triples — short by ${gap}.`,
    );
    console.log(
      "This is the HONEST count: no agencies or fields were invented to hit 30.\n" +
        "STILL NEEDED (source-verified data only — see issue #23 / #98 research):\n" +
        "  - Onboard additional SeeClickFix Open311 cities (Milpitas, Morgan Hill,\n" +
        "    Gilroy) once their boundaries are seeded — each adds verified API\n" +
        "    triples for ROAD_DAMAGE / ILLEGAL_DUMPING. These are NOT yet seeded\n" +
        "    jurisdictions (no boundary polygon), so they cannot be counted here.\n" +
        "  - Verify Palo Alto 311 / Mountain View dumping / SCC service catalogs\n" +
        "    (those agency pages returned HTTP 403 or are JS SPAs and could not be\n" +
        "    field-verified). Promoting them adds no NEW triples but raises\n" +
        "    confidence on existing ones.\n" +
        "  - A second VERIFIED VEHICLE_EMISSIONS modality (e.g. a CARB web-form\n" +
        "    URL, or BAAQMD as a seeded special-district) would add emissions\n" +
        "    triples beyond the single PHONE channel currently verified.",
    );
  }

  if (strict && !meetsTarget) process.exitCode = 1;
}

// Only run the report when executed directly (not when imported by tests).
if (process.argv[1] && process.argv[1].endsWith("coverage.ts")) {
  main();
}
