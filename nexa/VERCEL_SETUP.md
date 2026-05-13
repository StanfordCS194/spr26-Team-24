# Vercel Setup Guide

This document describes how to deploy Nexa to production on Vercel — what to
paste into the env-vars dashboard, how to provision the production database,
and the one-time migration step.

> The Vercel project is already linked (see `nexa/.vercel/project.json`). You
> do **not** need to run `vercel link` again.

---

## 1. Provision a production Postgres

Recommended: **Neon** via the Vercel Marketplace integration. It's free for the
demo's traffic volume and exposes a pooled connection string that Prisma handles
natively.

1. From the Vercel dashboard, open the `nexa` project → **Storage** tab.
2. Click **Create Database** → **Neon Postgres** → accept the defaults
   (`nexa-prod-db`, region close to your users).
3. **Important:** when connecting, change the **Custom Prefix** from `STORAGE`
   to `DATABASE` so that the injected env var is called `DATABASE_URL`
   (which is what Prisma expects).
4. Once provisioned, Neon will auto-inject `DATABASE_URL` into the project's
   env vars. **Verify** it's set under Settings → Environment Variables for
   all three environments (Production, Preview, Development).

Alternative: Vercel Postgres works identically; pick whichever the Storage
tab offers first.

---

## 2. Environment variables to add in Vercel

Settings → Environment Variables → add each of the following for the **Production**
environment (and **Preview** if you want PR deploys to work end-to-end).

| Key                        | Value                                     | Notes                                                                                     |
| -------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------- |
| `DATABASE_URL`             | _(auto-set by Neon — verify it's there)_  | Pooled connection string.                                                                 |
| `JWT_SECRET`               | output of `openssl rand -base64 32`       | Must be **different** from the local-dev secret in `.env.local`.                          |
| `OPENAI_API_KEY`           | `sk-…` from platform.openai.com           | Required. Used by classification + civic form lookup.                                     |
| `ANTHROPIC_API_KEY`        | `sk-ant-…` from console.anthropic.com     | Required. Used by multi-LLM classification consensus engine.                              |
| `GOOGLE_API_KEY`           | from aistudio.google.com                  | Required. Used by multi-LLM classification consensus engine.                              |
| `GOOGLE_MAPS_API_KEY`      | from console.cloud.google.com             | Optional. Enables Google Places address autocomplete; falls back to Nominatim when unset. |
| `NEXT_PUBLIC_POSTHOG_KEY`  | `phc_…` from app.posthog.com              | Required for the K2 time-to-submit telemetry.                                             |
| `NEXT_PUBLIC_POSTHOG_HOST` | `https://us.i.posthog.com`                | Match the region of your PostHog project.                                                 |
| `NEXT_PUBLIC_APP_URL`      | `https://<your-vercel-domain>.vercel.app` | Used to construct absolute URLs in agency-receipt emails.                                 |

> **Note:** AI provider clients (OpenAI, Anthropic, Google) use lazy
> initialization, so the build will succeed even if their API keys are not
> set in a Preview environment — the endpoints will just return errors at
> runtime when called without keys.

---

## 3. Database migrations

The `build` script in `package.json` runs:

```
prisma generate && ([ -n "$DATABASE_URL" ] && prisma migrate deploy || true) && next build
```

This means **migrations are applied automatically** during every Vercel build
when `DATABASE_URL` is set. If `DATABASE_URL` is not set (e.g. in some Preview
environments), the migration step is skipped gracefully and the build continues.

You can also apply migrations manually from your laptop:

```bash
cd nexa
DATABASE_URL="<paste Neon connection string>" npx prisma migrate deploy
```

---

## 4. Sanity checks after deploying

1. Hit `https://<your-domain>/api/health` — should return `{"status":"ok"}`.
2. Hit `https://<your-domain>/` — landing page should render.
3. Register a new user, log in, file a test report. Check Neon's SQL console
   to confirm a row appears in the `Report` table.
4. Open PostHog → Events; you should see `report_classified` and
   `report_submitted` events.

---

## 5. Rollback

The Vercel dashboard's **Deployments** tab → any prior green deployment →
"Promote to Production" is a one-click rollback. Database migrations are
**not** auto-rolled-back — keep them additive (no `DROP COLUMN` etc.) during
the demo period.
