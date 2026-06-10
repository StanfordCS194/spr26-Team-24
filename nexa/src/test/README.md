# Test toolkit (`src/test/`)

Shared infrastructure for the Vitest suite. Import everything from the barrel:

```ts
import { renderWithProviders, prismaMock, makeReport, server } from "@/test";
```

## Test pyramid & where tests live

- **Unit / integration** — node environment. Files: `src/lib/**/*.test.ts`,
  `src/app/**/*.test.ts`.
- **Component / hooks** — jsdom environment. Files:
  `src/components/**/*.test.tsx`, `src/hooks/**/*.test.tsx`,
  `src/i18n/**/*.test.tsx`.
- **e2e** — Playwright, in `e2e/*.spec.ts` (a separate runner; not Vitest).

Test files are **colocated** next to source as `*.test.ts(x)` — there is no
top-level `__tests__/` tree. Follow AAA (Arrange-Act-Assert), one behavior per
`it`, and keep tests deterministic: no real network (MSW only), no real
LLM/DB calls, control time with `vi.useFakeTimers()`.

## Prisma mock strategy — DECISION

**We deep-mock the `@/lib/prisma` singleton; we do NOT run a real or ephemeral
database in this suite.**

Rationale:

- The app accesses the database **only** through the `prisma` singleton exported
  from `src/lib/prisma.ts`. Mocking that one module intercepts every query.
- A deep mock (`mockDeep<PrismaClient>()` from `vitest-mock-extended`) gives a
  fully-typed proxy: `prismaMock.report.create.mockResolvedValue(...)` is
  type-checked against the real client, so tests break if the schema changes.
- No Postgres container, no migrations, no flakiness, instant startup — unit and
  integration tests stay fast and hermetic. (A real-DB integration tier, if ever
  needed, is a separate concern from this foundation.)

Usage:

```ts
import { prismaMock, makeReport } from "@/test";

// Importing prisma-mock (directly or via the barrel) auto-mocks @/lib/prisma
// and auto-resets the mock before each test.
it("returns the report", async () => {
  prismaMock.report.findUnique.mockResolvedValue(makeReport({ id: "r1" }));
  // ...call the route/lib that uses prisma, assert on the result
});
```

`resetPrismaMock()` is wired into a global `beforeEach`; call it manually only if
you need an extra reset mid-test.

## MSW (network)

`server` (node) is started/stopped globally in `vitest.setup.tsx` with
`onUnhandledRequest: "error"` — any un-stubbed request fails the test. Add
per-test handlers with `server.use(...)`; the `jsonGet`/`jsonPost` helpers cover
the common JSON case. `src/test/msw/browser.ts` exposes a `worker` for
Playwright if an e2e spec needs in-page network stubbing.

## Rendering components

`renderWithProviders(ui)` wraps the component in the app's client providers
(`I18nProvider`, `PostHogProvider`) and returns RTL's result plus a
`userEvent` instance. `next/navigation`, `next/headers`, and `next/image` are
globally mocked in `vitest.setup.tsx`.

## Factories & fixtures — how to add one

- **Factories** (`factories/`) build full Prisma rows with sensible defaults and
  accept `Partial<Model>` overrides — `makeUser`, `makeReport`, `makeAgency`.
  To add one: type the return as the generated model
  (`@/generated/prisma/client`), fill every field deterministically, spread
  `...overrides` last, and re-export from `index.ts`.
- **Fixtures** (`fixtures/`) are static sample payloads — `classification`
  (`ProviderResult`/`ComparisonResult`), `open311` (config + wire responses),
  `geo` (a small GeoJSON FeatureCollection). Add new ones the same way and
  re-export from `index.ts`.

## Env

`src/test/env.ts` (loaded first by the setup file) sets `JWT_SECRET`,
`NODE_ENV`, and a placeholder `DATABASE_URL` so modules that read these at import
time don't crash. `NEXT_PUBLIC_POSTHOG_*` are intentionally left unset (the app
tolerates their absence). For more overrides use a committed `.env.test`; never
require real secrets in this suite.

## Coverage gate & ratchet policy

Coverage is enforced as a CI gate, not just reported. `npm run test:coverage`
(v8 provider) fails — locally and in CI — when coverage drops below the
thresholds in [`vitest.config.ts`](../../vitest.config.ts). The `test` job in
`.github/workflows/ci.yml` runs this command, publishes the v8 text-summary to
the GitHub Actions job summary, and uploads the lcov/HTML report as an artifact.
No Codecov token is required — the built-in threshold failure is the gate.

**Thresholds are a one-way ratchet.** They may only ever be **raised, never
lowered.** Each floor is pinned a few points under the real measured coverage so
the current suite passes while making regression impossible.

Floors as of this writing (measured baseline → floor):

| Scope                             | Statements | Branches | Functions | Lines |
| --------------------------------- | ---------- | -------- | --------- | ----- |
| **Global** (baseline 86/77/85/89) | 85         | 75       | 83        | 87    |
| `src/lib/classify/**`             | 95         | —        | —         | 95    |
| `src/lib/submission/**`           | 90         | —        | —         | 90    |
| `src/lib/jurisdictions/**`        | 90         | —        | —         | 90    |
| `src/lib/auth.ts`                 | 90         | —        | —         | 90    |

Rules:

1. A PR that **raises** real coverage should bump the matching floor up to lock
   the gain in. Long-term target: **global lines 80% / branches 70%** and above
   (the suite already exceeds this — keep ratcheting toward 90%+).
2. **Never lower a floor to make a red build green.** Fix it by adding tests, or
   by `exclude`-ing genuinely non-source paths (generated code, config, the
   `src/test/` toolkit, `eval/`, `e2e/`) — already excluded in the config.
3. Coverage is a behavior-coverage gate (QA), kept separate from the eval job
   (#92), which gates LLM/routing accuracy. They are distinct steps/jobs.
