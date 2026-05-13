# Vercel Setup Guide

This document describes how to deploy Nexa to production on Vercel — what to
paste into the env-vars dashboard, how to provision the production database,
and the one-time migration step.

> The Vercel project is already linked (see `nexa/.vercel/project.json`). You
> do **not** need to run `vercel link` again.

---

## 1. Provision a production Postgres

Recommended: **Neon** via the Vercel Marketplace integration. It's free for the
demo's traffic volume and exposes a pooled connection string that Prisma 7's
`@prisma/adapter-pg` (already in `package.json`) handles natively.

1. From the Vercel dashboard, open the `nexa` project → **Storage** tab.
2. Click **Create Database** → **Neon Postgres** → accept the defaults
   (`nexa-prod-db`, region close to your users).
3. Once provisioned, Neon will auto-inject `DATABASE_URL` into the project's
   env vars. **Verify** it's set under Settings → Environment Variables for
   all three environments (Production, Preview, Development).

Alternative: Vercel Postgres works identically; pick whichever the Storage
tab offers first.

---

## 2. Environment variables to add in Vercel

Settings → Environment Variables → add each of the following for the **Production**
environment (and **Preview** if you want PR deploys to work end-to-end).

| Key | Value | Notes |
|---|---|---|
| `DATABASE_URL` | _(auto-set by Neon — verify it's there)_ | Pooled connection string. |
| `JWT_SECRET` | output of `openssl rand -base64 32` | Must be **different** from the local-dev secret in `.env.local`. |
| `OPENAI_API_KEY` | `sk-…` from platform.openai.com | Required. Used by `/api/reports/classify`. |
| `ANTHROPIC_API_KEY` | `sk-ant-…` from console.anthropic.com | Only required on the `llm-comparison` branch. |
| `GOOGLE_API_KEY` | from aistudio.google.com | Only required on the `llm-comparison` branch. |
| `NEXT_PUBLIC_POSTHOG_KEY` | `phc_…` from app.posthog.com | Required for the K2 time-to-submit telemetry. |
| `NEXT_PUBLIC_POSTHOG_HOST` | `https://us.i.posthog.com` | Match the region of your PostHog project. |
| `NEXT_PUBLIC_APP_URL` | `https://<your-vercel-domain>.vercel.app` | Used to construct absolute URLs in agency-receipt emails. |

---

## 3. Run the production migration once

Vercel's build step runs `prisma generate && next build` (see `package.json`'s
`build` script) but **not** `migrate deploy`. You need to apply the schema to
the Neon DB once, from your laptop:

```bash
cd nexa
# Pull the production DATABASE_URL into a temp local var so the migration
# script targets the prod DB, not your local Docker DB:
DATABASE_URL="<paste Neon connection string>" npx prisma migrate deploy
```

After this, every future migration committed to `main` will need the same
command run once (or wired into a GitHub Action).

---

## 4. Sanity checks after deploying

1. Hit `https://<your-domain>/api/health` — should return `{"status":"ok"}`.
2. Hit `https://<your-domain>/` — landing page should render.
3. Register a new user, log in, file a test report. Check Neon's SQL console
   to confirm a row appears in the `Report` table.
4. Open PostHog → Events; you should see `report_started` and
   `report_submitted` events.

---

## 5. Rollback

The Vercel dashboard's **Deployments** tab → any prior green deployment →
"Promote to Production" is a one-click rollback. Database migrations are
**not** auto-rolled-back — keep them additive (no `DROP COLUMN` etc.) during
the demo period.
