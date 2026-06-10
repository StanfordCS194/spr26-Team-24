import { defineConfig, devices } from "@playwright/test";

// Dedicated config for the human-paced full-workflow VIDEO (demo-workflow.spec.ts).
// Mirrors playwright.demo.config.ts: video always on at 1280x720, no parallelism,
// reuses an already-running dev server, and boots one with a throwaway JWT_SECRET +
// NODE_ENV=test if none is up. The recorded .webm under test-results/ is the
// deliverable (converted to public/demo-workflow.mp4 by the build step).
export default defineConfig({
  testDir: "./e2e",
  testMatch: /demo-workflow\.spec\.ts/,
  timeout: 180_000,
  fullyParallel: false,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3000",
    video: { mode: "on", size: { width: 1280, height: 720 } },
    viewport: { width: 1280, height: 720 },
  },
  projects: [{ name: "workflow", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 120_000,
    env: {
      JWT_SECRET: "demo-recording-secret-not-used-in-prod",
      NODE_ENV: "test",
    },
  },
});
