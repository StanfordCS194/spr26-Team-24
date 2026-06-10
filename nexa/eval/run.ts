/**
 * Run the routing/classification eval set against the live classifier.
 *
 *   npx tsx eval/run.ts                         # both modes, full dataset
 *   npx tsx eval/run.ts --mode=baseline         # single-stage only (the old behavior)
 *   npx tsx eval/run.ts --mode=two-stage        # new two-stage pipeline only
 *   npx tsx eval/run.ts --limit=10              # subset for quick smoke-runs
 *   npx tsx eval/run.ts --no-download           # use cases.json URLs without local cache
 *
 * Output:
 *   eval/results/baseline.json     — single-stage predictions + metrics
 *   eval/results/two-stage.json    — two-stage predictions + metrics
 *   stdout                         — pretty-printed report and delta
 *
 * Requires OPENAI_API_KEY, ANTHROPIC_API_KEY, GOOGLE_API_KEY (loaded from
 * .env.local via dotenv). Hits real APIs — costs ~$0.02 per case across the
 * three providers, plus another $0.001 for the stage-1 observation pass.
 */
import "dotenv/config";
import { config as loadEnv } from "dotenv";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { classifyWithConsensus } from "../src/lib/classify/consensus";
import type { DatasetCase } from "./dataset/fetch";
import {
  aggregate,
  diffReport,
  flipReport,
  renderFlipReport,
  renderReport,
  type CasePrediction,
} from "./metrics";

loadEnv({ path: path.resolve(process.cwd(), ".env.local") });
loadEnv({ path: path.resolve(process.cwd(), ".env") });

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, "..");
const CASES_PATH = path.join(here, "dataset", "cases.json");
const CACHE_DIR = path.join(here, "dataset", "_cache");
const RESULTS_DIR = path.join(here, "results");

interface Args {
  mode: "baseline" | "two-stage" | "both";
  limit: number | null;
  download: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { mode: "both", limit: null, download: true };
  for (const a of argv.slice(2)) {
    if (a.startsWith("--mode=")) {
      const m = a.slice("--mode=".length);
      if (m === "baseline" || m === "two-stage" || m === "both") args.mode = m;
    } else if (a.startsWith("--limit=")) {
      const n = parseInt(a.slice("--limit=".length), 10);
      if (Number.isFinite(n) && n > 0) args.limit = n;
    } else if (a === "--no-download") {
      args.download = false;
    }
  }
  return args;
}

function localPathFor(c: DatasetCase): string {
  if (c.source === "local") {
    return path.join(REPO_ROOT, c.url);
  }
  const ext = c.mime === "image/png" ? ".png" : ".jpg";
  return path.join(CACHE_DIR, `${c.id}${ext}`);
}

async function ensureLocal(
  c: DatasetCase,
  allowDownload: boolean,
): Promise<string> {
  const target = localPathFor(c);
  if (existsSync(target)) return target;
  if (c.source === "local") {
    throw new Error(`local case file missing: ${target}`);
  }
  if (!allowDownload) {
    throw new Error(
      `missing cached file ${target} (re-run with downloads enabled)`,
    );
  }
  await mkdir(path.dirname(target), { recursive: true });
  const res = await fetch(c.url, {
    headers: { "User-Agent": "Nexa-Eval/1.0" },
  });
  if (!res.ok) throw new Error(`download HTTP ${res.status} for ${c.url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(target, buf);
  return target;
}

async function loadAsBase64DataUrl(
  c: DatasetCase,
  allowDownload: boolean,
): Promise<string> {
  const file = await ensureLocal(c, allowDownload);
  const bytes = await readFile(file);
  const mime = c.mime || "image/jpeg";
  return `data:${mime};base64,${bytes.toString("base64")}`;
}

async function runCase(
  c: DatasetCase,
  imageDataUrl: string,
  twoStage: boolean,
): Promise<CasePrediction> {
  const start = Date.now();
  const result = await classifyWithConsensus(c.caption ?? "", imageDataUrl, {
    twoStage,
    location: c.exifGps
      ? { latitude: c.exifGps.latitude, longitude: c.exifGps.longitude }
      : null,
  });
  const latencyMs = Date.now() - start;
  return {
    caseId: c.id,
    expected: c.expected,
    predicted: result.winner.issueType,
    confidence: result.winner.confidence,
    consensusMethod: result.method,
    latencyMs,
    ok: result.winner.issueType === c.expected,
  };
}

async function runMode(
  cases: DatasetCase[],
  twoStage: boolean,
  allowDownload: boolean,
): Promise<CasePrediction[]> {
  const predictions: CasePrediction[] = [];
  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    process.stdout.write(
      `  [${(i + 1).toString().padStart(2)}/${cases.length}] ${c.id.padEnd(50).slice(0, 50)} `,
    );
    try {
      const img = await loadAsBase64DataUrl(c, allowDownload);
      const p = await runCase(c, img, twoStage);
      predictions.push(p);
      const mark = p.ok ? "✓" : "✗";
      console.log(
        `${mark}  expected=${p.expected.padEnd(18)} got=${p.predicted}`,
      );
    } catch (err) {
      console.log(`SKIP (${(err as Error).message})`);
    }
  }
  return predictions;
}

async function main() {
  const args = parseArgs(process.argv);

  if (!process.env.OPENAI_API_KEY) {
    console.error(
      "OPENAI_API_KEY is not set. Add it to nexa/.env.local before running.",
    );
    process.exit(2);
  }

  const raw = await readFile(CASES_PATH, "utf-8");
  let cases = JSON.parse(raw) as DatasetCase[];
  if (args.limit !== null) cases = cases.slice(0, args.limit);

  await mkdir(RESULTS_DIR, { recursive: true });

  let baselineMetrics = null;
  let twoStageMetrics = null;
  let baselinePreds: CasePrediction[] | null = null;
  let twoStagePreds: CasePrediction[] | null = null;

  if (args.mode === "baseline" || args.mode === "both") {
    console.log(`\n>>> Baseline (single-stage), n=${cases.length}`);
    const preds = await runMode(cases, false, args.download);
    baselinePreds = preds;
    baselineMetrics = aggregate(preds);
    await writeFile(
      path.join(RESULTS_DIR, "baseline.json"),
      JSON.stringify(
        {
          mode: "baseline",
          datasetSize: cases.length,
          ranAt: new Date().toISOString(),
          predictions: preds,
          metrics: baselineMetrics,
        },
        null,
        2,
      ) + "\n",
    );
    console.log(renderReport("Baseline (single-stage)", baselineMetrics));
  }

  if (args.mode === "two-stage" || args.mode === "both") {
    console.log(
      `\n>>> Two-stage (preprocess + observe + classify), n=${cases.length}`,
    );
    const preds = await runMode(cases, true, args.download);
    twoStagePreds = preds;
    twoStageMetrics = aggregate(preds);
    await writeFile(
      path.join(RESULTS_DIR, "two-stage.json"),
      JSON.stringify(
        {
          mode: "two-stage",
          datasetSize: cases.length,
          ranAt: new Date().toISOString(),
          predictions: preds,
          metrics: twoStageMetrics,
        },
        null,
        2,
      ) + "\n",
    );
    console.log(renderReport("Two-stage", twoStageMetrics));
  }

  if (baselineMetrics && twoStageMetrics) {
    console.log(
      diffReport("Baseline", baselineMetrics, "Two-stage", twoStageMetrics),
    );
  }

  // Per-case flip diff: which exact cases the observation stage helped vs hurt,
  // and the per-category net contribution. This is the inspectable artifact the
  // regression investigation (issue #96) needs — run with --mode=both so both
  // prediction sets exist in one process.
  if (baselinePreds && twoStagePreds) {
    const flips = flipReport(baselinePreds, twoStagePreds);
    console.log(renderFlipReport("Two-stage", flips));
    await writeFile(
      path.join(RESULTS_DIR, "flips.json"),
      JSON.stringify({ ranAt: new Date().toISOString(), ...flips }, null, 2) +
        "\n",
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
