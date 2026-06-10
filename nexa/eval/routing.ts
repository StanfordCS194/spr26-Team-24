/**
 * Run the routing eval set against the offline jurisdiction routing engine.
 *
 *   npx tsx eval/routing.ts                # full dataset
 *   npx tsx eval/routing.ts --limit=10     # subset for quick smoke-runs
 *
 * Output:
 *   eval/results/routing.json   — per-case predictions + metrics
 *   stdout                      — pretty-printed report and pass/fail vs target
 *
 * Runs fully OFFLINE: it only calls `resolveJurisdiction` / `getPortal`, which
 * are pure polygon lookups over the bundled boundaries.json. No network, no
 * LLM, and no database — so it is safe to run in CI without any API keys.
 *
 * NOTE: full AGENCY-level routing (lat/lng + issueType -> specific Agency record)
 * lives behind the agency resolver (`resolveAgencyId`, issue #24), which needs a
 * live Prisma/DB connection and therefore cannot run offline here. This harness
 * validates JURISDICTION-level resolution today and is structured so an
 * `expectedAgencyName` column + an offline agency lookup can be slotted in once
 * #24 lands.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveJurisdiction } from "../src/lib/jurisdictions/resolve";
import { getPortal } from "../src/lib/jurisdictions/registry";
import type { JurisdictionId } from "../src/lib/jurisdictions/types";

const here = path.dirname(fileURLToPath(import.meta.url));
const CASES_PATH = path.join(here, "dataset", "routing-cases.json");
const RESULTS_DIR = path.join(here, "results");

/** Target accuracy for O2.KR1 ( >=85% over >=50 issue x GPS pairs ). */
const TARGET_ACCURACY = 0.85;

interface RoutingCase {
  id: string;
  latitude: number;
  longitude: number;
  issueType: string;
  expectedJurisdictionId: JurisdictionId;
  contested?: boolean;
  note?: string;
}

interface RoutingPrediction {
  caseId: string;
  expected: JurisdictionId;
  predicted: JurisdictionId | null;
  hasPortal: boolean;
  contested: boolean;
  ok: boolean;
}

interface RoutingMetrics {
  total: number;
  correct: number;
  accuracy: number;
  resolved: number;
  coverage: number;
  contestedTotal: number;
  contestedCorrect: number;
  contestedAccuracy: number;
  perJurisdiction: Record<
    string,
    { support: number; correct: number; accuracy: number }
  >;
  confusion: Record<string, Record<string, number>>;
}

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

function runCase(c: RoutingCase): RoutingPrediction {
  const match = resolveJurisdiction(c.latitude, c.longitude, c.issueType);
  const predicted = match?.jurisdiction.id ?? null;
  // getPortal is exercised independently to keep it part of the offline path.
  const portal = predicted ? getPortal(predicted, c.issueType) : null;
  return {
    caseId: c.id,
    expected: c.expectedJurisdictionId,
    predicted,
    hasPortal: portal !== null,
    contested: Boolean(c.contested),
    ok: predicted === c.expectedJurisdictionId,
  };
}

function aggregate(predictions: RoutingPrediction[]): RoutingMetrics {
  const total = predictions.length;
  const correct = predictions.filter((p) => p.ok).length;
  const accuracy = total === 0 ? 0 : correct / total;

  const resolved = predictions.filter((p) => p.predicted !== null).length;
  const coverage = total === 0 ? 0 : resolved / total;

  const contested = predictions.filter((p) => p.contested);
  const contestedCorrect = contested.filter((p) => p.ok).length;
  const contestedAccuracy =
    contested.length === 0 ? 0 : contestedCorrect / contested.length;

  const perJurisdiction: RoutingMetrics["perJurisdiction"] = {};
  const confusion: RoutingMetrics["confusion"] = {};
  for (const p of predictions) {
    const cls = perJurisdiction[p.expected] ?? {
      support: 0,
      correct: 0,
      accuracy: 0,
    };
    cls.support++;
    if (p.ok) cls.correct++;
    cls.accuracy = cls.support === 0 ? 0 : cls.correct / cls.support;
    perJurisdiction[p.expected] = cls;

    const predictedLabel = p.predicted ?? "<unresolved>";
    const row = confusion[p.expected] ?? {};
    row[predictedLabel] = (row[predictedLabel] ?? 0) + 1;
    confusion[p.expected] = row;
  }

  return {
    total,
    correct,
    accuracy,
    resolved,
    coverage,
    contestedTotal: contested.length,
    contestedCorrect,
    contestedAccuracy,
    perJurisdiction,
    confusion,
  };
}

function renderReport(label: string, metrics: RoutingMetrics): string {
  const lines: string[] = [];
  lines.push(`\n=== ${label} ===`);
  lines.push(
    `Accuracy:  ${(metrics.accuracy * 100).toFixed(1)}%  (${metrics.correct}/${metrics.total})  target >=${(TARGET_ACCURACY * 100).toFixed(0)}%`,
  );
  lines.push(
    `Coverage:  ${(metrics.coverage * 100).toFixed(1)}%  (${metrics.resolved}/${metrics.total} resolved to a jurisdiction)`,
  );
  lines.push(
    `Contested: ${(metrics.contestedAccuracy * 100).toFixed(1)}%  (${metrics.contestedCorrect}/${metrics.contestedTotal} boundary cases correct)`,
  );

  lines.push("\nPer-jurisdiction accuracy:");
  const ids = Object.keys(metrics.perJurisdiction).sort();
  for (const id of ids) {
    const v = metrics.perJurisdiction[id];
    lines.push(
      `  ${id.padEnd(34)} ${(v.accuracy * 100).toFixed(1)}%  (${v.correct}/${v.support})`,
    );
  }

  lines.push("\nConfusion matrix (rows=expected, cols=predicted):");
  const allLabels = new Set<string>();
  for (const expected of Object.keys(metrics.confusion)) {
    allLabels.add(expected);
    for (const predicted of Object.keys(metrics.confusion[expected])) {
      allLabels.add(predicted);
    }
  }
  const labelList = Array.from(allLabels).sort();
  const header = "expected\\predicted";
  lines.push(
    `  ${header.padEnd(34)}${labelList.map((l) => l.slice(0, 10).padStart(12)).join("")}`,
  );
  for (const expected of labelList) {
    if (!metrics.confusion[expected]) continue;
    const row = metrics.confusion[expected] ?? {};
    const cells = labelList.map((l) => String(row[l] ?? 0).padStart(12));
    lines.push(`  ${expected.padEnd(34)}${cells.join("")}`);
  }

  return lines.join("\n");
}

async function main() {
  const args = parseArgs(process.argv);

  const raw = await readFile(CASES_PATH, "utf-8");
  let cases = JSON.parse(raw) as RoutingCase[];
  if (args.limit !== null) cases = cases.slice(0, args.limit);

  console.log(
    `\n>>> Routing engine (offline jurisdiction resolution), n=${cases.length}`,
  );
  const predictions: RoutingPrediction[] = [];
  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    const p = runCase(c);
    predictions.push(p);
    const mark = p.ok ? "✓" : "✗";
    const tag = p.contested ? " [contested]" : "";
    console.log(
      `  [${(i + 1).toString().padStart(2)}/${cases.length}] ${c.id.padEnd(34).slice(0, 34)} ${mark}  expected=${p.expected.padEnd(34)} got=${p.predicted ?? "<unresolved>"}${tag}`,
    );
  }

  const metrics = aggregate(predictions);

  await mkdir(RESULTS_DIR, { recursive: true });
  await writeFile(
    path.join(RESULTS_DIR, "routing.json"),
    JSON.stringify(
      {
        mode: "routing",
        datasetSize: cases.length,
        target: TARGET_ACCURACY,
        ranAt: new Date().toISOString(),
        predictions,
        metrics,
      },
      null,
      2,
    ) + "\n",
  );

  console.log(renderReport("Routing engine (jurisdiction-level)", metrics));

  const pass = metrics.accuracy >= TARGET_ACCURACY;
  console.log(
    `\n${pass ? "PASS" : "BELOW TARGET"}: routing accuracy ${(metrics.accuracy * 100).toFixed(1)}% vs target ${(TARGET_ACCURACY * 100).toFixed(0)}% (O2.KR1).`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
