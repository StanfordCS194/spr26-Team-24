# Nexa

A Next.js application for reporting and tracking civic issues (road damage, streetlight outages, illegal dumping, etc.).

## Prerequisites

- [Node.js](https://nodejs.org/) v22 or later
- [Docker Desktop](https://www.docker.com/products/docker-desktop/)

## Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/your-org/spr26-Team-24.git
cd spr26-Team-24/nexa
```

### 2. Install dependencies

```bash
npm install
```

### 3. Set up environment variables

Create a `.env` file in the `nexa/` directory:

```bash
cp .env.example .env
```

The default values will work with the Docker database out of the box.

### 4. Start the database

From the **root of the repository** (one level above `nexa/`):

```bash
cd ..
docker compose up -d
```

This starts a PostgreSQL 16 container on port 5432.

> **Note:** If you have a local PostgreSQL server already running on port 5432, stop it first or it will conflict with the Docker container.

To verify the database is running:

```bash
docker ps
```

You should see a container named `nexa-db`.

### 5. Run database migrations

Back in the `nexa/` directory:

```bash
cd nexa
npx prisma migrate dev
```

This applies all migrations and generates the Prisma client.

### 6. Start the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Useful Commands

| Command | Description |
|---|---|
| `npm run dev` | Start the Next.js dev server |
| `npm run build` | Build for production |
| `npx prisma studio` | Open a visual database browser |
| `npx prisma migrate dev` | Apply pending migrations |
| `docker compose up -d` | Start the database (from repo root) |
| `docker compose down` | Stop the database (from repo root) |
