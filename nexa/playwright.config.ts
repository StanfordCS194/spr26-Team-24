import { defineConfig, devices } from "@playwright/test";

const IS_CI = !!process.env.CI;
const PORT = 3000;
const BASE_URL = `http://localhost:${PORT}`;

// A fixed, self-contained env for the e2e web server. JWT_SECRET is required by
// src/lib/auth.ts; the rest keep the app from depending on real secrets/DB while
// the smoke test only exercises public, unauthenticated pages.
const TEST_ENV = {
  NODE_ENV: "test",
  JWT_SECRET: "e2e-test-secret-do-not-use-in-production",
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
      name: "chromium",
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
