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
      // `text-summary` is also written to the CI job summary ($GITHUB_STEP_SUMMARY);
      // `lcov` is uploaded as a CI artifact. See .github/workflows/ci.yml.
      reporter: ["text", "text-summary", "html", "lcov"],
      reportsDirectory: "./coverage",
      exclude: [
        ...SHARED_EXCLUDE,
        // Config files, ambient type decls, and the shared test toolkit are not
        // application source and must not dilute (or be measured by) coverage.
        "**/*.config.*",
        "**/*.d.ts",
        "src/test/**",
        "vitest.setup.tsx",
      ],
      // ── Coverage gate (issue #120) ──────────────────────────────────────────
      // RATCHET POLICY: thresholds are a one-way floor — they may only ever be
      // RAISED, never lowered. They are pinned just under the CURRENT measured
      // coverage so the suite passes today but coverage can never regress; when a
      // PR genuinely raises coverage, bump the matching floor up to lock the gain
      // in. Long-term target: global lines 80% / branches 70%. See
      // src/test/README.md for the full policy. Do NOT drop a floor to make a
      // failing build pass — add tests, or `exclude` non-source paths instead.
      //
      // Measured baseline on main (2026-06): statements 86.47%, branches 77.43%,
      // functions 84.94%, lines 88.82%. Global floors sit a few points below.
      thresholds: {
        statements: 85,
        branches: 75,
        functions: 83,
        lines: 87,
        // Per-directory floors for the most-tested, highest-stakes code. These
        // are intentionally stricter than the global floor. Measured baseline:
        //   classify       S 100   / L 100
        //   submission     S 94.6  / L 95.9
        //   jurisdictions  S 92.2  / L 97.6
        //   auth.ts        S 100   / L 100
        // Floor held at >= 85% lines/statements per #120.
        "src/lib/classify/**": { statements: 95, lines: 95 },
        "src/lib/submission/**": { statements: 90, lines: 90 },
        "src/lib/jurisdictions/**": { statements: 90, lines: 90 },
        "src/lib/auth.ts": { statements: 90, lines: 90 },
      },
    },
  },
});
