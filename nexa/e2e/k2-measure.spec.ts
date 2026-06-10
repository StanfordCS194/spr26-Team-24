import { expect, test, type Page } from "@playwright/test";

// K2 time-to-submit MEASUREMENT spec (#237). Drives the real guest report flow
//
//   /report -> describe (text + stubbed photo + stubbed address/location)
//           -> Analyze Issue (classify) -> review -> Submit Report
//           -> confirmation
//
// K2_RUNS times (default 15) and reads the LITERAL `time_to_submit_ms` value the
// APP emits on its `report_submitted` PostHog event — not a re-implementation.
// The provider's measurement tap (a `capture` wrapper, gated on
// NEXT_PUBLIC_POSTHOG_CAPTURE_DEBUG, set by playwright.config.ts) mirrors every
// captured event onto window.__phEvents synchronously, so we read the exact
// number with no network/batching/encoding to decode and no dependency on the
// SDK send pipeline. Median + p90 are computed and asserted against the SLO
// (median <= 60s, p90 <= 180s).
//
// This spec is intentionally KEPT OUT of the default `chromium` (CI) project and
// the `full-workflow-video` project — it runs under its own `k2-measure`
// project (see playwright.config.ts) so it never slows or destabilises CI. Run:
//
//   npx playwright test --project=k2-measure
//   K2_RUNS=25 npx playwright test --project=k2-measure
//
// IMPORTANT CAVEAT (documented in docs/metrics/time-to-submit.md): every network
// call is stubbed, so these runs EXCLUDE real LLM classification latency
// (classifyWithConsensus mean 5,471 ms baseline / 7,302 ms two-stage per
// eval/results/SUMMARY.md). The measured numbers therefore reflect UI/transition
// time only; the realistic end-to-end interval is ~6-10 s once LLM latency is
// added back (still well under the 60 s / 180 s SLO). True production K2 must be
// read from PostHog (HogQL, see the doc).

const RUNS = Number(process.env.K2_RUNS ?? 15);

interface PhEvent {
  event: string;
  properties: { time_to_submit_ms?: number; [k: string]: unknown };
}

// --- Deterministic stub payloads (mirror full-workflow.spec.ts) -------------

const CLASSIFY_RESULT = {
  success: true,
  data: {
    winner: {
      issueType: "ROAD_DAMAGE",
      aiDescription:
        "A large pothole in the roadway poses a hazard to vehicles and cyclists.",
      severity: "high",
      confidence: 0.95,
    },
    allResults: [
      {
        provider: "stub-model",
        latencyMs: 12,
        issueType: "ROAD_DAMAGE",
        aiDescription:
          "A large pothole in the roadway poses a hazard to vehicles and cyclists.",
        severity: "high",
        confidence: 0.95,
      },
    ],
    consensus: true,
    method: "unanimous",
  },
};

const CREATED_REPORT = {
  success: true,
  data: {
    id: "rep_k2_measure_0001",
    issueType: "ROAD_DAMAGE",
    description: null,
    aiDescription:
      "A large pothole in the roadway poses a hazard to vehicles and cyclists.",
    createdAt: "2026-06-09T12:00:00.000Z",
  },
};

const ADDRESS_SUGGESTIONS = {
  success: true,
  data: {
    suggestions: [
      {
        displayName: "123 Main St, Springfield",
        latitude: 37.422,
        longitude: -122.084,
      },
    ],
  },
};

const ONE_PNG_PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

/** Stub every client-side route the report flow touches, plus abort posthog. */
async function stubReportRoutes(page: Page) {
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      status: 401,
      json: { success: false, error: "Not authenticated" },
    }),
  );
  await page.route("**/api/reports/classify", (route) =>
    route.fulfill({ json: CLASSIFY_RESULT }),
  );
  await page.route("**/api/reports/form-link", (route) =>
    route.fulfill({
      json: {
        success: true,
        data: {
          status: "not_found",
          cityName: null,
          message: "No official form found.",
          reason: "Stubbed for e2e.",
        },
      },
    }),
  );
  await page.route("**/api/reports/agency-candidates", (route) =>
    route.fulfill({
      json: {
        success: true,
        data: {
          candidates: [
            {
              id: "agency_e2e_stub",
              name: "City Public Works",
              jurisdiction: "Springfield",
            },
          ],
          ambiguous: false,
        },
      },
    }),
  );
  await page.route("**/api/location/suggest**", (route) =>
    route.fulfill({ json: ADDRESS_SUGGESTIONS }),
  );
  await page.route("**/api/reports", (route) => {
    if (route.request().method() === "POST") {
      return route.fulfill({ json: CREATED_REPORT });
    }
    return route.continue();
  });
  await page.route("**/api/reports/*/submit", (route) =>
    route.fulfill({
      json: {
        success: true,
        data: {
          reportId: CREATED_REPORT.data.id,
          status: "SUBMITTED",
          submitted: true,
          externalTrackingId: "TRK-STUB-1",
        },
      },
    }),
  );
  // PostHog ingestion. The SDK's host is a SAME-ORIGIN sentinel path
  // (`/__posthog_e2e`, set in playwright.config.ts), so every event POST stays
  // on the machine; we return 200 so the SDK is happy and never retries. The
  // measurement does NOT depend on these requests — the `capture` wrapper tap
  // mirrors events onto window.__phEvents synchronously, before any send — this
  // route just keeps the network quiet. (Scoped to the sentinel path so it never
  // matches the posthog-js JS chunk under /_next/static, aborting which would
  // break the page.)
  await page.route("**/__posthog_e2e/**", (route) =>
    route.fulfill({ status: 200, json: { status: 1 } }),
  );
}

/** Run one full capture -> submit loop and return the app's emitted time_to_submit_ms. */
async function measureOneRun(page: Page): Promise<number> {
  // A fresh navigation to /report per run re-arms flowStartedAt so the K2 clock
  // starts from a real first-capture. (Direct nav, not via the homepage CTA, to
  // keep the per-run cost low across K2_RUNS iterations.)
  await page.goto("/report");

  // Reset the tap so we read only THIS run's event.
  await page.evaluate(() => {
    (window as unknown as { __phEvents?: unknown[] }).__phEvents = [];
  });

  // Describe: first keystroke starts the K2 clock (markCaptureStart).
  const description = page.getByRole("textbox", { name: "Description" });
  await description.fill(
    "Large pothole on Main St near the crosswalk, deep enough to damage a tire.",
  );

  await page.setInputFiles("#photo-input", {
    name: "pothole.png",
    mimeType: "image/png",
    buffer: ONE_PNG_PIXEL,
  });

  const addressInput = page.getByRole("combobox", { name: "Location" });
  await addressInput.fill("123 Main");
  const suggestion = page.getByRole("option", { name: /123 Main St/i });
  await expect(suggestion).toBeVisible();
  await suggestion.click();
  await expect(page.getByText(/GPS:\s*37\.422/)).toBeVisible();

  await page.getByRole("button", { name: /analyze issue/i }).click();

  // Review -> submit.
  await expect(page.getByText(/road damage/i).first()).toBeVisible();
  await page.getByRole("button", { name: /^submit report$/i }).click();

  // Confirmation = terminal state; the report_submitted event has fired by now.
  await expect(page.getByText(/report submitted!/i)).toBeVisible();
  await expect(page.getByText(CREATED_REPORT.data.id)).toBeVisible();

  // Read the LITERAL time_to_submit_ms the app emitted on report_submitted.
  const ms = await page.waitForFunction(() => {
    const events = (window as unknown as { __phEvents?: PhEvent[] }).__phEvents;
    const submitted = events?.find((e) => e.event === "report_submitted");
    const value = submitted?.properties?.time_to_submit_ms;
    return typeof value === "number" ? value : null;
  });
  return (await ms.jsonValue()) as number;
}

function median(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function percentile(sorted: number[], p: number): number {
  // Nearest-rank p-th percentile (matches PostHog's quantile semantics closely
  // enough for the snapshot; the doc records the production HogQL read).
  if (sorted.length === 0) return 0;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(rank, sorted.length) - 1];
}

test.describe("K2 time-to-submit measurement", () => {
  // N full UI loops; budget ~20s/run plus headroom so a slow machine doesn't
  // trip the test timeout while the suite drives every iteration.
  test.setTimeout(20_000 * RUNS + 60_000);

  test(`measures time_to_submit_ms over ${RUNS} guest report runs`, async ({
    page,
  }) => {
    await stubReportRoutes(page);

    const samples: number[] = [];
    for (let i = 0; i < RUNS; i++) {
      samples.push(await measureOneRun(page));
    }

    const sorted = [...samples].sort((a, b) => a - b);
    const medianMs = median(sorted);
    const p90Ms = percentile(sorted, 90);

    // Emit the measured numbers so they can be pasted into the snapshot doc.
    console.log(
      `\n[K2 measurement] n=${samples.length} ` +
        `min=${sorted[0]}ms median=${medianMs}ms ` +
        `p90=${p90Ms}ms max=${sorted[sorted.length - 1]}ms\n` +
        `samples=${JSON.stringify(sorted)}\n`,
    );

    // Every run must have produced a real, positive measurement.
    expect(samples).toHaveLength(RUNS);
    for (const s of samples) {
      expect(s).toBeGreaterThan(0);
    }

    // SLO assertions (the values are wall-clock UI time; see the doc's caveat
    // for the LLM-latency-inclusive realistic estimate).
    expect(medianMs).toBeLessThanOrEqual(60_000);
    expect(p90Ms).toBeLessThanOrEqual(180_000);
  });
});
