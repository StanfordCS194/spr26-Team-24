# Nexa

A full-stack Next.js application for reporting and tracking civic issues (road damage, streetlight outages, illegal dumping, etc.). AI-powered classification compares results across multiple LLMs to make the best judgment, and an official city form lookup surfaces the correct 311 / Report-an-Issue page for the user's location.

## Tech Stack

- **Frontend**: Next.js 16, React 19, TypeScript, Tailwind CSS v4, shadcn/ui
- **Backend**: Next.js API Routes (under `src/app/api/`)
- **AI Classification**: Multi-provider consensus engine (OpenAI GPT-4o-mini, Anthropic Claude 3.5 Haiku, Google Gemini 2.0 Flash)
- **Database**: PostgreSQL (Neon on Vercel, Docker for local dev), Prisma ORM
- **Address Autocomplete**: Google Places API (with Nominatim fallback)
- **Civic Form Lookup**: OpenAI Responses API with `web_search_preview` tool
- **Telemetry**: PostHog (passive event tracking, session replays)
- **Auth**: JWT-based sessions (jose)
- **Deployment**: Vercel (auto-deploys from `main`)
- **CI**: GitHub Actions (lint, type-check, format check on PRs)

## Features

- **Report submission wizard** — describe an issue with text, photo, or both; detect GPS location or type an address with autocomplete suggestions
- **Multi-LLM AI classification** — three providers classify in parallel; a consensus engine picks the best result; the review step shows a comparison panel
- **Official city form lookup** — after classification, Nexa finds the official 311 / Report-an-Issue page for the user's city and surfaces a direct link (Nexa never sends data to the external site)
- **Dashboard** — personal history of submitted reports with status tracking, category labels, and two-step report deletion
- **Auth** — register, login, and session-aware navbar
- **Address autocomplete** — Google Places suggestions (falls back to Nominatim when `GOOGLE_MAPS_API_KEY` is unset)

## AI Classification — How It Works

When a user submits a report, the `/api/reports/classify` endpoint sends the image and description to **three LLM providers in parallel**:

| Provider | Model | Strengths |
|---|---|---|
| OpenAI | `gpt-4o-mini` | Fast, strong vision, low cost |
| Anthropic | `claude-3-5-haiku-20241022` | Fast, careful reasoning, low cost |
| Google | `gemini-2.0-flash` | Fast, good at structured output |

A **consensus engine** then picks the best result:

1. **Unanimous** — all 3 agree on the issue type → use the highest-confidence answer
2. **Majority** — 2 of 3 agree → use the majority answer with highest confidence
3. **Highest confidence** — all disagree → use the single most confident result
4. **Fallback** — all providers fail → return "OTHER" for manual review

The review step shows the user the winning classification **and** a comparison panel showing how each model responded, including latency and confidence scores.

## Project Structure

```
spr26-Team-24/
├── docker-compose.yml        # PostgreSQL database (local dev)
├── .github/workflows/ci.yml  # CI pipeline
└── nexa/                     # Next.js application
    ├── src/
    │   ├── app/              # Pages and API routes
    │   │   ├── api/
    │   │   │   ├── auth/             # Login, register, logout, session
    │   │   │   ├── health/           # Health check endpoint
    │   │   │   ├── location/
    │   │   │   │   └── suggest/      # Address autocomplete (Google Places / Nominatim)
    │   │   │   └── reports/
    │   │   │       ├── route.ts      # POST — create a report
    │   │   │       ├── classify/     # POST — multi-LLM classification
    │   │   │       ├── form-link/    # POST — official city form lookup
    │   │   │       └── [id]/         # DELETE — remove a report (owner only)
    │   │   ├── dashboard/    # Report tracking dashboard
    │   │   ├── login/        # Login page
    │   │   ├── register/     # Registration page
    │   │   └── report/       # Report submission flow
    │   ├── components/
    │   │   ├── dashboard/
    │   │   │   └── delete-report-button.tsx
    │   │   ├── report/
    │   │   │   ├── describe-step.tsx   # Step 1: description + photo + location
    │   │   │   ├── review-step.tsx     # Step 2: AI result + form link + edit
    │   │   │   ├── confirmed-step.tsx  # Step 3: confirmation
    │   │   │   └── stepper.tsx         # Progress indicator
    │   │   └── ui/           # shadcn/ui primitives
    │   ├── lib/
    │   │   ├── classify/     # Multi-LLM classification engine
    │   │   │   ├── types.ts           # Shared types and prompt
    │   │   │   ├── openai-provider.ts
    │   │   │   ├── anthropic-provider.ts
    │   │   │   ├── google-provider.ts
    │   │   │   └── consensus.ts       # Voting / comparison logic
    │   │   ├── auth.ts       # JWT session helpers
    │   │   ├── prisma.ts     # Prisma client singleton
    │   │   ├── openai.ts     # OpenAI client (lazy init)
    │   │   └── constants.ts  # Issue type labels, etc.
    │   ├── hooks/
    │   │   ├── use-geolocation.ts  # GPS detect + reverse geocode + setCoordinates
    │   │   └── use-image-upload.ts # Photo upload / drag-drop
    │   └── types/            # TypeScript type definitions
    └── prisma/
        ├── schema.prisma     # Database schema
        └── migrations/       # Database migrations
```

## Prerequisites

- [Node.js](https://nodejs.org/) v22 or later
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (optional — only needed for local Postgres; production uses Neon)

## Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/StanfordCS194/spr26-Team-24.git
cd spr26-Team-24
```

### 2. Install dependencies

```bash
cd nexa
npm install
```

### 3. Set up environment variables

```bash
cp .env.example .env.local
```

Open `.env.local` and fill in your API keys. The app can connect to the production Neon database directly for local development (recommended), or you can run Postgres locally via Docker.

| Key | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string (Neon or local Docker) |
| `JWT_SECRET` | Yes | Session token signing |
| `OPENAI_API_KEY` | Yes | GPT-4o-mini classification + civic form lookup |
| `ANTHROPIC_API_KEY` | Yes | Claude 3.5 Haiku classification |
| `GOOGLE_API_KEY` | Yes | Gemini 2.0 Flash classification |
| `GOOGLE_MAPS_API_KEY` | Optional | Google Places address autocomplete (falls back to Nominatim) |
| `NEXT_PUBLIC_POSTHOG_KEY` | For telemetry | PostHog analytics |
| `NEXT_PUBLIC_POSTHOG_HOST` | For telemetry | PostHog region host |

For production deployment, see [`nexa/VERCEL_SETUP.md`](nexa/VERCEL_SETUP.md).

### 4. Set up the database

**Option A — Use the production Neon database (recommended for demo):**

Set `DATABASE_URL` in `.env.local` to the Neon connection string, then run:

```bash
cd nexa
npx prisma migrate deploy
```

**Option B — Local Postgres via Docker:**

```bash
# From repo root
docker compose up -d
cd nexa
npx prisma migrate dev
```

### 5. Start the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Daily Startup Checklist

After initial setup is done, use these commands each time you come back to the project:

1. (If using local Docker DB) start the database from repo root:

```bash
docker compose up -d
```

2. Start the app (from `nexa/`):

```bash
cd nexa
npm run dev
```

3. Open the app:
   - Usually [http://localhost:3000](http://localhost:3000)
   - If port 3000 is already in use, Next.js will auto-pick another port (for example `http://localhost:3001`)

## Useful Commands

| Command | Description |
|---|---|
| `npm run dev` | Start the dev server (from `nexa/`) |
| `npm run build` | Build for production (from `nexa/`) |
| `npm run lint` | Run ESLint (from `nexa/`) |
| `npm run format` | Format code with Prettier (from `nexa/`) |
| `npm run format:check` | Check formatting without writing (from `nexa/`) |
| `npx prisma studio` | Open a visual database browser (from `nexa/`) |
| `npx prisma migrate dev` | Create and apply migrations locally (from `nexa/`) |
| `npx prisma migrate deploy` | Apply pending migrations to production (from `nexa/`) |
| `docker compose up -d` | Start the local database (from repo root) |
| `docker compose down` | Stop the local database (from repo root) |

## Wiki

- [Home](https://github.com/StanfordCS194/spr26-Team-24/wiki)
- [PRD](https://github.com/StanfordCS194/spr26-Team-24/wiki/PRD)
- [Measure For Success (OKRs/KPIs)](https://github.com/StanfordCS194/spr26-Team-24/wiki/Measure-For-Success)
- [Customer Discovery Summary](https://github.com/StanfordCS194/spr26-Team-24/wiki/Customer-Discovery-Summary)
- [Midpoint User Testing Plan](https://github.com/StanfordCS194/spr26-Team-24/wiki/Midpoint-User-Testing-Plan)
