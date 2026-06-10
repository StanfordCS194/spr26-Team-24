/**
 * End-to-end agency-accuracy harness (O1.KR1).
 *
 *   npx tsx eval/end-to-end.ts                # full dataset
 *   npx tsx eval/end-to-end.ts --limit=10     # subset for quick smoke-runs
 *   npm run eval:end-to-end
 *
 * Output:
 *   eval/results/end-to-end.json   — per-case results + metrics
 *   stdout                         — pretty report and pass/fail vs target
 *
 * WHAT IT MEASURES (O1.KR1): the single AGENCY-level accuracy number — given a
 * civic report (latitude + longitude + issueType), does the routing→agency step
 * reach the EXPECTED agency on the FIRST attempt? This isolates the
 * routing→agency hop: the jurisdiction routing eval (eval/routing.ts) measures
 * jurisdiction accuracy and image classification is measured separately; this
 * harness joins lat/lng + issueType straight through to the seeded Agency.
 *
 * "Correct-agency-first-try" per case:
 *   - Confident match (resolveAgencyId returns a single agencyId): correct when
 *     that agency's name equals expectedAgencyName.
 *   - Ambiguous match (agencyId null, multiple candidates — e.g. Menlo Park's
 *     web-form desk AND its Open311 API both cover the spot): correct when
 *     expectedAgencyName is among the candidate agencies. Disambiguating between
 *     equally-valid candidates is the "future caller" concern resolveAgencyId
 *     documents it defers, so any covering candidate counts as a first-try hit.
 *   - Unresolved (no candidates): always incorrect.
 *
 * FULLY OFFLINE. No network, no live database, no LLM. Like eval/readiness.ts it
 * REUSES the production `resolveAgencyId` (which normally hits Prisma) by
 * installing an in-memory Prisma stub on `globalThis.prisma` BEFORE the module
 * is imported. The stub is backed by the SAME seeded `AGENCIES` array
 * `prisma/seed.ts` writes to the DB, so routing behaves identically — there is
 * no parallel routing/agency logic here.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { IssueType } from "../src/generated/prisma/enums";
import { AGENCIES, type AgencySeed } from "../prisma/agencies";

// ---------------------------------------------------------------------------
// Offline Prisma stub (same pattern as eval/readiness.ts).
//
// `src/lib/prisma.ts` resolves `prisma` as `globalForPrisma.prisma || <new
// client>`. By setting `globalThis.prisma` to an in-memory stub here, BEFORE any
// module that imports `@/lib/prisma` loads, we avoid instantiating a real
// PG-backed client — so the harness needs no DATABASE_URL and makes no network
// or DB calls. The stub implements exactly the one query `resolveAgencyId`
// makes: `agency.findMany({ where: { jurisdiction, issueTypes: { has } },
// select: { id }, orderBy: { id: 'asc' } })`, served from `AGENCIES`.
// ---------------------------------------------------------------------------

type AgencyRow = AgencySeed & { id: string };

// Deterministic ids derived from the seed key (@@unique([jurisdiction, name])),
// matching prisma/seed.ts and eval/readiness.ts.
const AGENCY_ROWS: AgencyRow[] = AGENCIES.map((a) => ({
  ...a,
  id: `${a.jurisdiction}::${a.name}`,
}));

const agencyById = new Map(AGENCY_ROWS.map((a) => [a.id, a]));

type FindManyArgs = {
  where?: {
    jurisdiction?: string;
    issueTypes?: { has?: string };
  };
  orderBy?: { id?: "asc" | "desc" };
};

const prismaStub = {
  agency: {
    async findMany(args: FindManyArgs) {
      const jurisdiction = args.where?.jurisdiction;
      const issueType = args.where?.issueTypes?.has;
      let rows = AGENCY_ROWS.filter(
        (a) =>
          (jurisdiction === undefined || a.jurisdiction === jurisdiction) &&
          (issueType === undefined ||
            a.issueTypes.includes(
              issueType as AgencySeed["issueTypes"][number],
            )),
      );
      const dir = args.orderBy?.id ?? "asc";
      rows = rows
        .slice()
        .sort((a, b) =>
          dir === "desc" ? b.id.localeCompare(a.id) : a.id.localeCompare(b.id),
        );
      return rows.map((a) => ({ id: a.id }));
    },
  },
};

(globalThis as unknown as { prisma: unknown }).prisma = prismaStub;

// Production function, loaded lazily AFTER the stub above is installed so the
// `@/lib/prisma` singleton picks up our stub instead of constructing a real
// client. Dynamic import (not top-level await, which the CJS eval transform
// rejects) deferred into async `main()`.
type AgencyModule = typeof import("../src/lib/jurisdictions/agency");
let resolveAgencyId: AgencyModule["resolveAgencyId"];

async function loadDeps(): Promise<void> {
  const agency = await import("../src/lib/jurisdictions/agency");
  resolveAgencyId = agency.resolveAgencyId;
}

// ---------------------------------------------------------------------------
// Dataset
// ---------------------------------------------------------------------------

interface EndToEndCase {
  id: string;
  latitude: number;
  longitude: number;
  issueType: IssueType;
  /** The Agency `name` the report should reach on the first attempt. */
  expectedAgencyName: string;
  note?: string;
}

const here = path.dirname(fileURLToPath(import.meta.url));
const CASES_PATH = path.join(here, "dataset", "end-to-end-cases.json");
const RESULTS_DIR = path.join(here, "results");

/** O1.KR1 target: >=80% correct-agency-first-try over the dataset (n>=50). */
const TARGET_ACCURACY = 0.8;

// ---------------------------------------------------------------------------
// Per-case evaluation
// ---------------------------------------------------------------------------

type Outcome = "confident" | "ambiguous" | "unresolved";

interface CaseResult {
  caseId: string;
  issueType: IssueType;
  expectedAgencyName: string;
  outcome: Outcome;
  /** The confidently resolved agency name, when there is one. */
  resolvedAgencyName: string | null;
  /** Every covering agency name (the candidate set). */
  candidateNames: string[];
  /** True when the expected agency was reached on the first attempt. */
  correct: boolean;
  reason: string;
}

function nameOf(agencyId: string): string {
  return agencyById.get(agencyId)?.name ?? agencyId;
}

async function evaluateCase(c: EndToEndCase): Promise<CaseResult> {
  const { agencyId, candidates } = await resolveAgencyId({
    latitude: c.latitude,
    longitude: c.longitude,
    issueType: c.issueType,
  });
  const candidateNames = candidates.map(nameOf);

  // Unresolved: no agency covers this jurisdiction + issue type.
  if (candidates.length === 0) {
    return {
      caseId: c.id,
      issueType: c.issueType,
      expectedAgencyName: c.expectedAgencyName,
      outcome: "unresolved",
      resolvedAgencyName: null,
      candidateNames,
      correct: false,
      reason: "No agency covers this jurisdiction + issue type.",
    };
  }

  // Confident single match.
  if (agencyId) {
    const resolvedAgencyName = nameOf(agencyId);
    const correct = resolvedAgencyName === c.expectedAgencyName;
    return {
      caseId: c.id,
      issueType: c.issueType,
      expectedAgencyName: c.expectedAgencyName,
      outcome: "confident",
      resolvedAgencyName,
      candidateNames,
      correct,
      reason: correct
        ? `Confident match reached ${resolvedAgencyName}.`
        : `Confident match reached ${resolvedAgencyName}, expected ${c.expectedAgencyName}.`,
    };
  }

  // Ambiguous: agencyId null with multiple candidates. Correct when the expected
  // agency is among the covering candidates (any is a valid first-try channel).
  const correct = candidateNames.includes(c.expectedAgencyName);
  return {
    caseId: c.id,
    issueType: c.issueType,
    expectedAgencyName: c.expectedAgencyName,
    outcome: "ambiguous",
    resolvedAgencyName: null,
    candidateNames,
    correct,
    reason: correct
      ? `Ambiguous match; expected ${c.expectedAgencyName} is in the candidate set.`
      : `Ambiguous match; expected ${c.expectedAgencyName} not among [${candidateNames.join(", ")}].`,
  };
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

interface CategoryMetric {
  support: number;
  correct: number;
  accuracy: number;
}

interface EndToEndMetrics {
  total: number;
  correct: number;
  accuracy: number;
  resolved: number;
  coverage: number;
  ambiguous: number;
  perCategory: Record<string, CategoryMetric>;
}

function aggregate(results: CaseResult[]): EndToEndMetrics {
  const total = results.length;
  const correct = results.filter((r) => r.correct).length;
  const resolved = results.filter((r) => r.outcome !== "unresolved").length;
  const ambiguous = results.filter((r) => r.outcome === "ambiguous").length;

  const perCategory: Record<string, CategoryMetric> = {};
  for (const r of results) {
    const cat = perCategory[r.issueType] ?? {
      support: 0,
      correct: 0,
      accuracy: 0,
    };
    cat.support++;
    if (r.correct) cat.correct++;
    cat.accuracy = cat.support === 0 ? 0 : cat.correct / cat.support;
    perCategory[r.issueType] = cat;
  }

  return {
    total,
    correct,
    accuracy: total === 0 ? 0 : correct / total,
    resolved,
    coverage: total === 0 ? 0 : resolved / total,
    ambiguous,
    perCategory,
  };
}

function renderReport(metrics: EndToEndMetrics): string {
  const lines: string[] = [];
  lines.push("\n=== End-to-end agency accuracy (O1.KR1) ===");
  lines.push(
    `Correct-agency-first-try: ${(metrics.accuracy * 100).toFixed(1)}%  (${metrics.correct}/${metrics.total})  target >=${(TARGET_ACCURACY * 100).toFixed(0)}%`,
  );
  lines.push(
    `Routed:   ${(metrics.coverage * 100).toFixed(1)}%  (${metrics.resolved}/${metrics.total} reached >=1 candidate agency; ${metrics.ambiguous} ambiguous)`,
  );

  lines.push("\nPer-category correct-agency-first-try:");
  for (const cat of Object.keys(metrics.perCategory).sort()) {
    const v = metrics.perCategory[cat];
    lines.push(
      `  ${cat.padEnd(20)} ${(v.accuracy * 100).toFixed(1)}%  (${v.correct}/${v.support})`,
    );
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

interface Args {
  limit: number | null;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { limit: null };
  for (const a of argv.slice(2)) {
    if (a.startsWith("--limit=")) {
      const n = parseInt(a.slice("--limit=".length), 10);
      if (Number.isFinite(n) && n > 0) args.limit = n;
    }
  }
  return args;
}

async function main() {
  await loadDeps();
  const args = parseArgs(process.argv);

  const raw = await readFile(CASES_PATH, "utf-8");
  let cases = JSON.parse(raw) as EndToEndCase[];
  if (args.limit !== null) cases = cases.slice(0, args.limit);

  console.log(
    `\n>>> End-to-end agency accuracy (offline, no network/DB/LLM), n=${cases.length}`,
  );

  const results: CaseResult[] = [];
  for (let i = 0; i < cases.length; i++) {
    const r = await evaluateCase(cases[i]);
    results.push(r);
    const mark = r.correct ? "✓" : "✗";
    const got =
      r.resolvedAgencyName ??
      (r.outcome === "ambiguous"
        ? `[${r.candidateNames.join(" | ")}]`
        : "<unresolved>");
    console.log(
      `  [${(i + 1).toString().padStart(2)}/${cases.length}] ${cases[i].id.padEnd(26).slice(0, 26)} ${mark}  ${r.issueType.padEnd(18)} expected=${r.expectedAgencyName.padEnd(34)} got=${got}`,
    );
    if (!r.correct) console.log(`        ${r.reason}`);
  }

  const metrics = aggregate(results);

  await mkdir(RESULTS_DIR, { recursive: true });
  await writeFile(
    path.join(RESULTS_DIR, "end-to-end.json"),
    JSON.stringify(
      {
        mode: "end-to-end",
        datasetSize: cases.length,
        target: TARGET_ACCURACY,
        ranAt: new Date().toISOString(),
        results,
        metrics,
      },
      null,
      2,
    ) + "\n",
  );

  console.log(renderReport(metrics));

  const pass = metrics.accuracy >= TARGET_ACCURACY;
  console.log(
    `\n${pass ? "PASS" : "BELOW TARGET"}: end-to-end correct-agency-first-try ${(metrics.accuracy * 100).toFixed(1)}% vs target ${(TARGET_ACCURACY * 100).toFixed(0)}% (O1.KR1).`,
  );

  // Exit non-zero below target so CI gates the build on agency accuracy.
  if (!pass) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
