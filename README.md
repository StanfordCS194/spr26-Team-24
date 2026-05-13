# Nexa
David Lu

A full-stack Next.js application for reporting and tracking civic issues (road damage, streetlight outages, illegal dumping, etc.).

## Tech Stack

- **Frontend**: Next.js 16, React 19, TypeScript, Tailwind CSS v4, shadcn/ui
- **Backend**: Next.js API Routes (under `src/app/api/`)
- **Database**: PostgreSQL 16 (via Docker), Prisma ORM
- **CI**: GitHub Actions (lint, type-check, format check on PRs)

## Project Structure

```
spr26-Team-24/
├── docker-compose.yml        # PostgreSQL database
├── .github/workflows/ci.yml  # CI pipeline
└── nexa/                     # Next.js application
    ├── src/
    │   ├── app/              # Pages and API routes
    │   │   └── api/          # Backend API endpoints
    │   ├── components/       # React components
    │   ├── lib/              # Utility functions
    │   ├── hooks/            # Custom React hooks
    │   └── types/            # TypeScript type definitions
    └── prisma/
        ├── schema.prisma     # Database schema
        └── migrations/       # Database migrations
```

## Prerequisites

- [Node.js](https://nodejs.org/) v22 or later
- [Docker Desktop](https://www.docker.com/products/docker-desktop/)

## Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/StanfordCS194/spr26-Team-24.git
cd spr26-Team-24
```

### 2. Start the database

From the root of the repository:

```bash
docker compose up -d
```

This starts a PostgreSQL 16 container on port 5432.

> **Note:** If you have a local PostgreSQL server already running on port 5432, stop it first or it will conflict with the Docker container.

To verify the database is running:

```bash
docker ps
```

You should see a container named `nexa-db`.

### 3. Install dependencies

```bash
cd nexa
npm install
```

### 4. Set up environment variables

```bash
cp .env.example .env.local
```

Open `.env.local` and fill in any API keys you have (`OPENAI_API_KEY`,
`ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`, `NEXT_PUBLIC_POSTHOG_KEY`). The
`DATABASE_URL` and `JWT_SECRET` defaults already work against the Docker DB.

For production deployment, see [`nexa/VERCEL_SETUP.md`](nexa/VERCEL_SETUP.md).

### 5. Run database migrations

```bash
npx prisma migrate dev
```

This applies all migrations and generates the Prisma client.

### 6. Start the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

You can verify the backend is working by visiting [http://localhost:3000/api/health](http://localhost:3000/api/health).

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
