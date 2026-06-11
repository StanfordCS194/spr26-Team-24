# Nexa

A full-stack Next.js application for reporting and tracking civic issues (road damage, streetlight outages, illegal dumping, graffiti, and more). A resident photographs a problem, Nexa classifies it with a multi-LLM consensus engine, routes it to the responsible city agency, and either files it automatically (Open311 / email) or hands the resident a pre-filled submission assistant for the official city portal — then tracks the report's status to resolution.

## Tech Stack

- **Frontend**: Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS v4, shadcn/ui
- **Backend**: Next.js API Routes (under `src/app/api/`)
- **AI Classification**: Multi-provider consensus engine (OpenAI GPT-4o-mini, Anthropic Claude Haiku 4.5, Google Gemini 2.5 Flash)
- **Database**: PostgreSQL (Neon on Vercel, Docker for local dev), Prisma ORM
- **Submission**: Open311 GeoReport v2 client, email submission agent (Resend), and a manual-assist / submission-assistant fallback for web-form & phone intake
- **Routing**: Polygon-based jurisdiction registry + agency resolver, with an LLM web-search fallback for official city form lookup
- **Maps**: Leaflet (community issue map + dashboard pins)
- **Auth**: JWT sessions (jose); optional "Continue with Google" OAuth; optional anonymous reporting with account upgrade
- **i18n**: 4 languages — English, Español, 中文, Français
- **Notifications**: Brevo (citizen email), optional Web Push (VAPID)
- **Storage**: optional S3 / Cloudflare R2 image pipeline (base64 fallback)
- **Telemetry**: PostHog; optional Sentry error tracking
- **PWA**: installable, with an offline report queue + service worker
- **Testing**: Vitest (unit/integration), Playwright (e2e), custom offline eval harnesses
- **Deployment**: Vercel (auto-deploys from `main`), Vercel Cron for status polling
- **CI**: GitHub Actions (lint, type-check, format, tests + coverage gate, eval gates, production build, e2e)

## Features

- **Report submission wizard** — describe an issue with text, photo, or both; detect GPS location, type an address with autocomplete, or pull location from a photo's EXIF GPS
- **Multi-LLM AI classification** — three providers classify in parallel and a consensus engine picks the best result; the review step shows a per-model comparison panel
- **Auto issue detection** — uploading a photo pre-fills an editable AI-suggested description and detected issue type
- **Jurisdiction routing** — coordinates are matched to the responsible agency via a polygon registry, so each report is addressed to the correct city/department
- **Automated submission** — files reports to agencies via Open311 (GeoReport v2) or email where supported; falls back to a **submission assistant** that pre-fills every required field for the official city portal so the resident can copy them over (Nexa never silently submits where it can't)
- **Custom agency link override** — if auto-routing is wrong, the resident can supply their own link; Nexa checks whether it points at a submittable form (SSRF-guarded)
- **Status tracking** — a Vercel Cron job polls Open311 and advances report status (never regressing), plus a stale-report follow-up prompt
- **Community issue map** — reported issues shown as status-colored pins, with duplicate detection (nearby same-type reports group into one case) and shared resolution (resolving one resolves it for everyone linked)
- **Dashboard** — personal report history with status, category labels, map pins, and two-step deletion
- **Admin analytics** — submission/failure-rate dashboard with breakdowns
- **Auth** — register/login, optional Google sign-in, optional anonymous reporting that can later be claimed
- **Multilingual UI** — full interface translations across four languages
- **PWA + offline** — installable to a phone home screen; reports queued offline replay on reconnect

## AI Classification — How It Works

When a user submits a report, `/api/reports/classify` sends the image and description to **three LLM providers in parallel**:

| Provider | Model | Strengths |
|---|---|---|
| OpenAI | `gpt-4o-mini` | Fast, strong vision, low cost |
| Anthropic | `claude-haiku-4-5` | Fast, careful reasoning, low cost |
| Google | `gemini-2.5-flash` | Fast, good at structured output |

A **consensus engine** then picks the best result:

1. **Unanimous** — all 3 agree on the issue type → use the highest-confidence answer
2. **Majority** — 2 of 3 agree → use the majority answer with highest confidence
3. **Highest confidence** — all disagree → use the single most confident result
4. **Fallback** — all providers fail → return `OTHER` for manual review

Classification spans **18 civic issue categories** (road damage, streetlight outage, illegal dumping, graffiti, flooding/drainage, abandoned vehicle, and more). The review step shows the winning classification **and** a comparison panel with each model's latency and confidence.

## Routing & Submission — How It Works

1. **Resolve jurisdiction** — the report's coordinates are tested against a curated polygon registry to find the responsible jurisdiction and agency (`src/lib/jurisdictions/`).
2. **Pick an intake channel** — the orchestrator (`src/lib/submission/orchestrate.ts`) chooses how to file based on the agency's configured intake method:
   - **Open311 API** → builds a GeoReport v2 request and submits, returning a tracking id.
   - **Email** → composes a report email (photo attached) via Resend.
   - **Web form / phone** → no automated path, so it hands off to the **submission assistant**, which pre-fills the official portal's required fields for the resident to copy over.
3. **Track status** — `GET /api/cron/poll-status` (Vercel Cron, `CRON_SECRET`-guarded, fail-closed) polls Open311 for submitted reports and advances their status monotonically.

External submission features are **env-gated**: with the relevant keys unset, the agent is a no-op and the flow degrades gracefully to manual-assist rather than failing.

## Project Structure

```
spr26-Team-24/
├── docker-compose.yml          # PostgreSQL database (local dev)
├── .github/workflows/ci.yml    # CI: lint/typecheck, tests+coverage, eval gates, build, e2e
└── nexa/                       # Next.js application
    ├── src/
    │   ├── app/
    │   │   ├── api/
    │   │   │   ├── auth/             # register, login, logout, me, claim, google
    │   │   │   ├── cron/poll-status/ # Open311 status polling (cron, secret-gated)
    │   │   │   ├── health/           # DB health probe
    │   │   │   ├── issues/map/        # community map data
    │   │   │   ├── location/suggest/  # address autocomplete (Google Places / Nominatim)
    │   │   │   ├── push/              # web push subscribe / unsubscribe
    │   │   │   ├── reports/
    │   │   │   │   ├── route.ts            # create a report (+ dedup grouping)
    │   │   │   │   ├── classify/           # multi-LLM classification
    │   │   │   │   ├── form-link/          # official city form lookup
    │   │   │   │   ├── check-link/         # custom-link submittable-form check (SSRF-guarded)
    │   │   │   │   ├── agency-candidates/  # disambiguate ambiguous routing
    │   │   │   │   └── [id]/               # delete / submit / resolution / submission-fields
    │   │   │   └── uploads/presign/   # presigned S3/R2 upload
    │   │   ├── (auth)/ login/ register/   # auth pages
    │   │   ├── admin/                # analytics dashboard
    │   │   ├── dashboard/            # report tracking
    │   │   ├── map/                  # community issue map
    │   │   └── report/               # submission wizard
    │   ├── components/   # report wizard, dashboard, map, auth, ui primitives
    │   ├── lib/
    │   │   ├── classify/     # multi-LLM engine (providers + consensus)
    │   │   ├── submission/   # orchestrate, open311, email, prefill, link-check
    │   │   ├── jurisdictions/# polygon registry + agency resolver
    │   │   ├── issues/       # dedup + community map data
    │   │   ├── reports/      # status machine, follow-up, dedup window
    │   │   ├── push/ email/ admin/ api/ dashboard/
    │   │   ├── auth.ts prisma.ts openai.ts rate-limit.ts http.ts
    │   ├── hooks/            # geolocation, image upload, reports, link-check, speech
    │   └── i18n/             # 4-language message catalog + provider
    ├── prisma/              # schema, migrations, agency seed data
    ├── eval/                # offline eval harnesses (routing, readiness, submission, e2e)
    └── e2e/                 # Playwright specs
```

## Prerequisites

- [Node.js](https://nodejs.org/) v22 or later
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (optional — only for local Postgres; production uses Neon)

## Getting Started

### 1. Clone and install

```bash
git clone https://github.com/StanfordCS194/spr26-Team-24.git
cd spr26-Team-24/nexa
npm install
```

### 2. Configure environment

```bash
cp .env.example .env.local
```

Fill in your keys (see the table below). `.env.example` documents every variable inline, including which features each one gates.

### 3. Generate the Prisma client

```bash
npx prisma generate
```

> Run this after install (and after pulling schema changes) — `tsc` and the dev server depend on the generated client.

### 4. Set up the database

**Option A — Neon (recommended for demo):** set `DATABASE_URL` to the Neon string, then:

```bash
npx prisma migrate deploy
```

**Option B — Local Postgres via Docker:**

```bash
# from repo root
docker compose up -d
# from nexa/
npx prisma migrate dev
```

### 5. Run the app

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Environment Variables

Only `DATABASE_URL`, `JWT_SECRET`, and the LLM keys are needed to run the core flow; everything else is optional and **env-gated** (the related feature is a no-op until its keys are set). Full inline docs live in [`nexa/.env.example`](nexa/.env.example).

| Key | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string (Neon or local Docker) |
| `JWT_SECRET` | Yes | Session token signing |
| `OPENAI_API_KEY` | Yes | GPT-4o-mini classification + civic form lookup |
| `ANTHROPIC_API_KEY` | Yes* | Claude Haiku 4.5 (consensus classification) |
| `GOOGLE_API_KEY` | Yes* | Gemini 2.5 Flash (consensus classification) |
| `GOOGLE_MAPS_API_KEY` | Optional | Google Places autocomplete (falls back to Nominatim) |
| `GOOGLE_OAUTH_CLIENT_ID` / `_SECRET` | Optional | "Continue with Google" sign-in |
| `BREVO_API_KEY` / `BREVO_SENDER_EMAIL` | Optional | Citizen notification emails |
| `RESEND_API_KEY` / `SUBMISSION_FROM_EMAIL` | Optional | Automated email submission to EMAIL-intake agencies |
| `SUBMISSION_OVERRIDE_EMAIL` | Optional | Redirect all submission emails to one inbox (demo safety) |
| `CRON_SECRET` | Optional | Guards the Open311 status-polling cron (fails closed if unset) |
| `FOLLOW_UP_REMINDER_SECRET` | Optional | Guards the follow-up reminder job |
| `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW_MS` | Optional | Per-IP rate limit for expensive routes (defaults 20 / 60000ms) |
| `VAPID_*` / `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | Optional | Web push notifications |
| `S3_*` | Optional | S3 / Cloudflare R2 image upload (base64 fallback) |
| `SENTRY_DSN` | Optional | Server error tracking |
| `NEXT_PUBLIC_POSTHOG_KEY` / `_HOST` | Optional | PostHog analytics |
| `NEXT_PUBLIC_APP_URL` | Optional | App origin (links, OAuth redirects) |

\* OpenAI alone is enough to run classification; Anthropic + Google enable the full 3-way consensus and comparison panel.

For production deployment, see [`nexa/VERCEL_SETUP.md`](nexa/VERCEL_SETUP.md).

## Testing & Evaluation

```bash
npm test               # Vitest unit + integration suite
npm run test:coverage  # same suite with the coverage-threshold gate
npm run test:e2e       # Playwright end-to-end specs (Chromium)
```

**Eval harnesses** (offline, deterministic — no network/LLM/DB; they back the CI quality gates):

```bash
npm run eval:routing             # jurisdiction routing accuracy (O2.KR1)
npm run eval:validate-boundaries # boundary GeoJSON consistency
npm run eval:readiness           # submission-readiness: reach intake + fill fields (K3)
npm run eval:end-to-end          # correct-agency-first-try accuracy (O1.KR1)
npm run eval:submission          # submission-filing: the agent actually files (stubbed transport)
```

See [`nexa/eval/README.md`](nexa/eval/README.md), [`nexa/e2e/README.md`](nexa/e2e/README.md), and [`nexa/src/test/README.md`](nexa/src/test/README.md) for details.

## Continuous Integration

GitHub Actions runs on every PR and push to `main` (`.github/workflows/ci.yml`):

- **lint-and-typecheck** — ESLint, `tsc --noEmit`, Prettier check
- **test** — full Vitest suite with a coverage-threshold (ratchet) gate; coverage published to the job summary
- **eval** — routing, boundary-validation, readiness, end-to-end, and submission-filing gates (each fails the build below target)
- **build** — real `next build` to catch server/client-boundary and page-data errors pre-merge
- **e2e** — Playwright specs (deterministic, network stubbed)

## Useful Commands

| Command | Description |
|---|---|
| `npm run dev` | Start the dev server (from `nexa/`) |
| `npm run build` | Production build (from `nexa/`) |
| `npm run lint` | ESLint |
| `npm run format` / `format:check` | Prettier write / check |
| `npm test` / `test:coverage` / `test:e2e` | Unit / coverage-gated / e2e tests |
| `npm run eval:*` | Offline eval harnesses (see Testing & Evaluation) |
| `npx prisma generate` | Regenerate the Prisma client |
| `npx prisma studio` | Visual database browser |
| `npx prisma migrate dev` / `migrate deploy` | Apply migrations locally / to production |
| `docker compose up -d` / `down` | Start / stop the local database (from repo root) |

## Wiki

- [Home](https://github.com/StanfordCS194/spr26-Team-24/wiki)
- [PRD](https://github.com/StanfordCS194/spr26-Team-24/wiki/PRD)
- [Measure For Success (OKRs/KPIs)](https://github.com/StanfordCS194/spr26-Team-24/wiki/Measure-For-Success)
- [Customer Discovery Summary](https://github.com/StanfordCS194/spr26-Team-24/wiki/Customer-Discovery-Summary)
- [Midpoint User Testing Plan](https://github.com/StanfordCS194/spr26-Team-24/wiki/Midpoint-User-Testing-Plan)
