# Nexa Engineering Rule Book

The conventions every contributor follows on this repo. Keep it short, keep it followed. When a rule and the surrounding code disagree, fix the code or fix the rule — don't add a third style.

The app lives in [`nexa/`](./nexa). All commands below run from `nexa/` unless noted.

---

## 1. Golden rules

1. **Match the surrounding code.** Naming, file layout, error shape, and idioms should look like the file you're editing.
2. **No business logic in route handlers or components.** Logic lives in `src/lib/*`; routes and components orchestrate it. See §4.
3. **Type the boundaries.** Anything crossing a boundary (HTTP body, DB JSON, external API) gets a parsed, typed contract — never trust `request.json()` or `Json` fields as-is. See §5.
4. **Fail loud in dev, safe in prod.** Validate config at boot; return a consistent error shape; never silently swallow a `catch`. See §6.
5. **Every behavior change ships with a test.** Unit for logic, integration for routes, component for UI. See §7.
6. **Small PRs, green CI, one reviewer.** See §8–§9.
7. **No secrets in the repo, no `Co-Authored-By: Claude` (or any AI attribution) in commits.**

---

## 2. Project structure

```
nexa/
  src/
    app/            # Next.js App Router: pages + api/ route handlers (thin)
    components/     # React components (ui/ = shadcn primitives, feature folders otherwise)
    hooks/          # reusable client hooks
    lib/            # ALL business logic & shared utilities
      classify/     # multi-LLM classification + consensus
      jurisdictions/# routing engine (lat/lng + issueType -> agency)
      submission/   # agency submission agents (Open311, …)
      auth.ts       # JWT session sign/verify
      prisma.ts     # the ONLY place the Prisma client is instantiated
      constants.ts  # shared labels, colors, magic values
    generated/      # Prisma client output — generated, never edit, never import deep
  prisma/           # schema.prisma, migrations, seed
  eval/             # offline LLM-accuracy harness (NOT the test suite)
```

Rules:
- **Import via the `@/*` alias** (`@/lib/...`), never long relative `../../../` chains.
- **Touch the database only through `@/lib/prisma`.** Never `new PrismaClient()` elsewhere; never import from `src/generated/prisma` directly outside `lib/prisma.ts`.
- **`src/lib/constants.ts` is the home for magic numbers/strings** (labels, colors, thresholds, cookie names). If you write a literal twice, hoist it.
- Middleware is **`src/proxy.ts`** (Next 16 renamed it from `middleware.ts`). The Prisma datasource URL lives in `prisma.config.ts`, not `schema.prisma`.

---

## 3. Naming & conventions

| Thing | Convention | Example |
|---|---|---|
| Files / folders | kebab-case | `report-card.tsx`, `use-geolocation.ts` |
| React components | PascalCase | `ReportCard` |
| Hooks | `use` + camelCase | `useGeolocation` |
| Variables / functions | camelCase | `resolveJurisdiction` |
| Types / enums | PascalCase | `IssueType`, `ReportStatus` |
| Constants | SCREAMING_SNAKE_CASE | `MAX_DIMENSION` |
| DB models / enums | PascalCase model, SCREAMING enum | `Report`, `ROAD_DAMAGE` |

- TypeScript runs in **`strict` mode** — keep it green. **No `any`.** Prefer `unknown` + a parse step over a cast. Avoid non-null `!`; narrow instead.
- Prefer pure, side-effect-free functions in `lib/`; pass IO (fetch, prisma) in or isolate it at the edge so the logic stays testable.

---

## 4. Architecture & layering

- **Route handlers (`src/app/api/**`) are thin.** Parse + validate input → call a `lib/` service → shape the response. No multi-step business logic inline.
- **Components render and dispatch.** Data fetching/mutation goes through a hook or a `lib/` function, not inline `fetch` chains scattered across JSX.
- **One responsibility per module.** If a file mixes parsing + network + formatting and crosses ~300 LOC, split it (extract a service/helper). Large files to keep an eye on already have refactor issues filed.
- **Repository boundary for data access.** Prefer a small `lib/` function (`getReportForUser(id, userId)`) over duplicating the same Prisma query + ownership check across routes.

---

## 5. Type contracts & validation

- **Parse, don't assume.** Every `request.json()`, every `Agency.requiredFields` (`Json`) read, every external API response is parsed into a typed shape at the boundary. Reject what doesn't fit.
- Centralize request/response schemas so the client and server agree on one contract; reuse them rather than re-checking fields ad hoc.
- A function that can fail returns a **typed discriminated result** (`{ ok: true, … } | { ok: false, error }`) — follow the pattern in `src/lib/submission/open311.ts`; don't throw across module boundaries for expected failures.

---

## 6. Error handling

- **Consistent API error shape.** Every route returns errors as `{ error: string }` with the right status code:
  `400` bad input · `401` unauthenticated · `403` not owner · `404` missing · `409` conflict · `5xx` upstream/unexpected.
- **Never swallow.** A `catch` either handles meaningfully or rethrows — no empty `catch {}` and no catch that only sets local state without surfacing the failure.
- **Validate config at boot**, not on first use — a missing `DATABASE_URL` / session secret should fail fast and clearly.
- Don't add ad-hoc retries or loggers in a feature PR — those are tracked centrally (resilience #102, observability #108). Keep feature error handling to the consistent shape above.

---

## 7. Testing standard (test pyramid)

Test infrastructure is being stood up in **#112** (Vitest + jsdom + RTL + MSW + Playwright); everything below depends on it.

- **Unit** (most tests): pure logic in `lib/` — consensus, jurisdiction resolve, Open311 parsing, auth tokens. Fast, no IO.
- **Integration**: API route handlers with Prisma deep-mocked and external calls via MSW. Assert status codes, the error shape, and state transitions.
- **Component**: wizard steps, dashboard, forms via RTL; mock browser APIs (geolocation, Leaflet, FileReader) and `fetch`.
- **E2E** (few): the core loop (capture → classify → confirm → submit → track) and auth journeys via Playwright.

Rules:
- **Colocate** tests: `consensus.ts` → `consensus.test.ts` next to it. No top-level `__tests__/` tree.
- **AAA** (Arrange-Act-Assert), one behavior per `it`.
- **Deterministic & offline.** No real network/LLM/DB; mock with MSW / `vi.mock`. Control time with fake timers.
- `eval/` is the LLM-accuracy harness, **not** the test suite — don't conflate them.

---

## 8. Git & commits

- **Branch off `main`:** `feat/<slug>`, `fix/<slug>`, `docs/<slug>`, `chore/<slug>`. Never commit to `main` directly.
- **Conventional Commits with a scope:** `type(scope): subject`
  - Types: `feat`, `fix`, `docs`, `chore`, `style`, `refactor`, `test`, `eval`.
  - Examples (from this repo): `feat(submission): Open311 status polling service`, `fix(cron): run poll-status once daily for Vercel Hobby plan`, `docs(eval): …`.
  - Imperative mood, lower-case subject, no trailing period.
- **Do NOT add `Co-Authored-By: Claude` or any AI-attribution trailer.**
- Keep commits focused; run `npm run format` before committing.

---

## 9. Pull requests & review

- **Small and single-purpose.** One issue per PR where possible; link it (`Closes #NN`).
- **CI must be green** before review: lint, typecheck, tests (root `.github/workflows/ci.yml`, steps run with `working-directory: nexa`).
- **At least one approving review.** Reviewer checks: matches these rules, has tests, no logic-in-route/component, consistent error shape, no `any`/secrets.
- Before opening: `npm run lint && npm run format:check && npm run build` (and `npm test` once #112 lands).

---

## 10. Issues

- **Title prefix by area:** `[Frontend]`, `[Backend]`, `[API]`, `[AI]`, `[Data]`, `[Auth]`, `[Eval]`, `[QA]`, `[Infra]`, `[Security]`, `[Perf]`, `[A11y]`, `[DevOps]`, `[Refactor]`, `[Docs]`.
- **Labels:** `bug` for defects in existing code, `enhancement` for new work; add `good first issue` / `help wanted` where apt.
- A good issue body has: **Context/Problem** (with `file:line` evidence), **Scope**, **Files to change** (so we extend existing code, not duplicate it), and **Acceptance criteria** as checkboxes. Note dependencies on other issues.

---

## 11. Security & privacy (baseline)

- Secrets only via env vars; never commit them. Keep `.env.example` complete.
- Authenticate AND authorize every non-public route — ownership-check before read/edit/delete.
- Validate/clamp untrusted input (coordinates, lengths) and treat user text passed to LLMs as untrusted.
- Strip image EXIF/GPS unless the user opted into sharing location.
- Same-origin only for post-auth redirects; allowlist external/“official” URLs strictly.

---

## 12. Quick reference

```bash
# from nexa/
npm run dev            # local dev server
npm run lint           # eslint
npm run format         # prettier write   (format:check in CI)
npm run build          # prisma generate + migrate deploy + next build
npm run db:seed        # seed agencies
npm test               # unit/integration (after #112)
npm run test:e2e       # Playwright (after #112)
npm run eval           # LLM-accuracy harness (NOT the test suite)
```

> This rule book is a living document. Propose changes via a `docs/` PR; if a convention here is routinely ignored, either enforce it in CI/lint or remove it.
