import { defineConfig, devices } from "@playwright/test";

const IS_CI = !!process.env.CI;
const PORT = 3000;
const BASE_URL = `http://localhost:${PORT}`;

// A fixed, self-contained env for the e2e web server. JWT_SECRET is required by
// src/lib/auth.ts; the rest keep the app from depending on real secrets/DB while
// the smoke test only exercises public, unauthenticated pages.
//
// PostHog vars enable the K2 measurement spec (e2e/k2-measure.spec.ts): the key
// makes the SDK initialise so `report_submitted` (with `time_to_submit_ms`) is
// actually captured, and NEXT_PUBLIC_POSTHOG_CAPTURE_DEBUG turns on the
// `before_send` tap (see posthog-provider.tsx) that mirrors events onto
// window.__phEvents for the spec to read. `before_send` runs when the SDK
// FLUSHES an event, so the host must be REACHABLE and return 200 — the spec
// points it at a same-origin path it stubs with page.route, so no event ever
// leaves the machine. These are test-only values — never the real key.
const TEST_ENV = {
  NODE_ENV: "test",
  JWT_SECRET: "e2e-test-secret-do-not-use-in-production",
  NEXT_PUBLIC_POSTHOG_KEY: "phc_e2e_test_key_do_not_use_in_production",
  NEXT_PUBLIC_POSTHOG_HOST: `${BASE_URL}/__posthog_e2e`,
  NEXT_PUBLIC_POSTHOG_CAPTURE_DEBUG: "1",
};

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: IS_CI,
  retries: IS_CI ? 2 : 0,
  workers: IS_CI ? 1 : undefined,
  reporter: IS_CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: BASE_URL,
    trace: IS_CI ? "on-first-retry" : "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      // Default project: every spec EXCEPT the dedicated video walkthrough.
      // Leaves the existing CI e2e behaviour untouched (video only retained on
      // failure, per `use.video` above).
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      // The CI e2e job: exclude the video walkthrough AND the K2 measurement
      // spec so this default project stays fast and stable (k2-measure drives
      // the flow K2_RUNS times — too slow/noisy for CI).
      testIgnore: [
        /full-workflow\.spec\.ts/,
        /k2-measure\.spec\.ts/,
        /demo-human\.spec\.ts/,
        /demo-workflow\.spec\.ts/,
      ],
    },
    {
      // Dedicated project for the end-to-end walkthrough (#220). `video: "on"`
      // ALWAYS records a webm for this spec — pass or fail — and that recording
      // is the deliverable. Scoped to this single file so the rest of the suite
      // (and its CI expectations) keep the default `retain-on-failure`.
      name: "full-workflow-video",
      testMatch: /full-workflow\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], video: "on" },
    },
    {
      // K2 time-to-submit measurement (#237). Drives the real guest
      // capture->classify->review->submit->confirmation flow K2_RUNS times
      // (default 15) and reads the LITERAL `time_to_submit_ms` the app emits via
      // the window.__phEvents tap, then computes median + p90. Kept OUT of the
      // default `chromium` project (above) so it never slows or destabilises CI;
      // run it explicitly: `npx playwright test --project=k2-measure`.
      name: "k2-measure",
      testMatch: /k2-measure\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    // Boot the dev server with the fixed test env. Inlined so CI doesn't need a
    // separate build step for the smoke check.
    command: "npm run dev",
    url: BASE_URL,
    reuseExistingServer: !IS_CI,
    timeout: 120_000,
    env: TEST_ENV,
  },
});
