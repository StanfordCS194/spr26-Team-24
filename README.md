# Nexa

A full-stack Next.js application for reporting and tracking civic issues (road damage, streetlight outages, illegal dumping, etc.). AI-powered classification compares results across multiple LLMs to make the best judgment.

## Tech Stack

- **Frontend**: Next.js 16, React 19, TypeScript, Tailwind CSS v4, shadcn/ui
- **Backend**: Next.js API Routes (under `src/app/api/`)
- **AI Classification**: Multi-provider consensus engine (OpenAI GPT-4o-mini, Anthropic Claude Sonnet, Google Gemini 2.0 Flash)
- **Database**: PostgreSQL 16 (via Docker), Prisma ORM
- **Telemetry**: PostHog (passive event tracking, session replays)
- **Deployment**: Vercel
- **CI**: GitHub Actions (lint, type-check, format check on PRs)

## AI Classification — How It Works

When a user submits a report, the `/api/reports/classify` endpoint sends the image and description to **three LLM providers in parallel**:

| Provider | Model | Strengths |
|---|---|---|
| OpenAI | `gpt-4o-mini` | Fast, strong vision, low cost |
| Anthropic | `claude-sonnet` | Careful reasoning, good at ambiguous cases |
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
├── docker-compose.yml        # PostgreSQL database
├── .github/workflows/ci.yml  # CI pipeline
└── nexa/                     # Next.js application
    ├── src/
    │   ├── app/              # Pages and API routes
    │   │   ├── api/          # Backend API endpoints
    │   │   ├── dashboard/    # Report tracking dashboard
    │   │   └── report/       # Report submission flow
    │   ├── components/       # React components
    │   ├── lib/
    │   │   ├── classify/     # Multi-LLM classification engine
    │   │   │   ├── types.ts           # Shared types and prompt
    │   │   │   ├── openai-provider.ts
    │   │   │   ├── anthropic-provider.ts
    │   │   │   ├── google-provider.ts
    │   │   │   └── consensus.ts       # Voting / comparison logic
    │   │   └── ...           # Auth, Prisma, constants
    │   ├── hooks/            # Custom React hooks
    │   └── types/            # TypeScript type definitions
    └── prisma/
        ├── schema.prisma     # Database schema
        └── migrations/       # Database migrations
```

## Prerequisites

- [Node.js](https://nodejs.org/) v22 or later
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (optional — only needed for local Postgres)

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

Open `.env.local` and fill in any API keys you have (`OPENAI_API_KEY`,
`ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`, `NEXT_PUBLIC_POSTHOG_KEY`). The
`DATABASE_URL` and `JWT_SECRET` defaults already work against the Docker DB.

| Key | Required | Purpose |
|---|---|---|
| `OPENAI_API_KEY` | Yes | GPT-4o-mini classification |
| `ANTHROPIC_API_KEY` | Yes | Claude Sonnet classification |
| `GOOGLE_API_KEY` | Yes | Gemini Flash classification |
| `JWT_SECRET` | Yes | Session token signing |
| `DATABASE_URL` | For DB features | PostgreSQL connection string |
| `NEXT_PUBLIC_POSTHOG_KEY` | For telemetry | PostHog analytics |

For production deployment, see [`nexa/VERCEL_SETUP.md`](nexa/VERCEL_SETUP.md).

### 4. Start the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### 5. (Optional) Start the database

Only needed if you want real data persistence instead of localStorage:

```bash
# From repo root
docker compose up -d
cd nexa
npx prisma migrate dev
```

## Daily Startup Checklist

After initial setup is done, use these commands each time you come back to the project:

1. Start the database (from repo root):

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
| `npx prisma studio` | Open a visual database browser (from `nexa/`) |
| `npx prisma migrate dev` | Apply pending migrations (from `nexa/`) |
| `docker compose up -d` | Start the database (from repo root) |
| `docker compose down` | Stop the database (from repo root) |

## Wiki

- [Home](https://github.com/StanfordCS194/spr26-Team-24/wiki)
- [PRD](https://github.com/StanfordCS194/spr26-Team-24/wiki/PRD)
- [Measure For Success (OKRs/KPIs)](https://github.com/StanfordCS194/spr26-Team-24/wiki/Measure-For-Success)
- [Customer Discovery Summary](https://github.com/StanfordCS194/spr26-Team-24/wiki/Customer-Discovery-Summary)
