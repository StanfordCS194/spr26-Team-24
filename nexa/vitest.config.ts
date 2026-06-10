import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const srcAlias = fileURLToPath(new URL("./src", import.meta.url));

// Paths that are never tests and must stay out of both discovery and coverage:
// - eval/**         the separate LLM-accuracy harness (issue #92), not unit tests
// - src/generated/  Prisma's generated client
// - e2e/**          Playwright specs, run by their own runner
const SHARED_EXCLUDE = [
  "**/node_modules/**",
  "**/dist/**",
  "**/.next/**",
  "eval/**",
  "src/generated/**",
  "e2e/**",
];

export default defineConfig({
  resolve: {
    // Mirror tsconfig.json `paths`: "@/*" -> "./src/*"
    alias: { "@": srcAlias },
  },
  test: {
    globals: true,
    setupFiles: ["./vitest.setup.tsx"],
    // Two projects so node-environment tests (lib/API) and jsdom-environment
    // tests (components/hooks) coexist in one `vitest run`.
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          include: [
            "src/*.test.{ts,tsx}",
            "src/lib/**/*.test.{ts,tsx}",
            "src/app/**/*.test.{ts,tsx}",
          ],
          exclude: SHARED_EXCLUDE,
        },
      },
      {
        extends: true,
        test: {
          name: "jsdom",
          environment: "jsdom",
          include: [
            "src/components/**/*.test.{ts,tsx}",
            "src/hooks/**/*.test.{ts,tsx}",
            "src/i18n/**/*.test.{ts,tsx}",
          ],
          exclude: SHARED_EXCLUDE,
        },
      },
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      reportsDirectory: "./coverage",
      // No thresholds yet — the coverage-gate issue owns enforcement.
      exclude: [
        ...SHARED_EXCLUDE,
        "**/*.config.*",
        "**/*.d.ts",
        "src/test/**",
        "vitest.setup.tsx",
      ],
    },
  },
});
