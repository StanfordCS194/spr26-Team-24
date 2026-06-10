# Operations runbook: backups, disaster recovery, and observability

This runbook covers the **DevOps** concerns for a production Nexa deployment:
database backup / point-in-time restore (PITR) with explicit RTO/RPO targets and
a recovery procedure, plus the error-tracking / APM strategy. It complements the
deploy steps in [`VERCEL_SETUP.md`](../VERCEL_SETUP.md) — read that first for how
the app and the Neon database are provisioned.

---

## 1. Database backup, PITR, and disaster recovery (Neon Postgres)

The production database is **Neon Postgres** (see `VERCEL_SETUP.md` §1). Neon's
storage is built on a copy-on-write branching architecture that retains a log of
data changes, which is what powers its restore capabilities.

### 1.1 What Neon actually gives you

| Capability                 | What it is                                                                                               |
| -------------------------- | -------------------------------------------------------------------------------------------------------- |
| **Instant restore (PITR)** | Roll a branch back to any point in time within the project's **history window** (a retained change log). |
| **Restore branch**         | Create a _new_ branch at a past timestamp for inspection/recovery without touching the live branch.      |
| **Manual `pg_dump`**       | Standard logical backups you run yourself (`pg_dump` → `pg_restore`); portable, off-Neon copies.         |

**History window (retention) by plan** — this is the maximum age you can restore
back to, and it is a project-wide setting under **Settings → Instant restore** in
the Neon Console:

| Neon plan | Default history window | Maximum         |
| --------- | ---------------------- | --------------- |
| Free      | 6 hours                | 6 hours (fixed) |
| Launch    | 1 day                  | up to 7 days    |
| Scale     | 1 day                  | up to 30 days   |

A longer history window increases storage cost, since Neon must keep more change
data. Verify the current value (and your plan) in the Neon Console before relying
on a target below.

> Accuracy note: instant restore covers data that is _within_ the history window.
> It is **not** a substitute for off-platform backups if you need to recover from
> an event older than the window, or to migrate off Neon. For business
> continuity / compliance, also take periodic `pg_dump` backups (§1.4).

### 1.2 Recommended targets (RTO / RPO)

For the demo's traffic and data-loss tolerance:

| Metric                             | Target                               | Backed by                                                                                              |
| ---------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| **RPO** (max acceptable data loss) | ≈ 0 (continuous)                     | Neon instant restore retains a continuous change log within the window.                                |
| **RTO** (max time to recover)      | ≤ 30 minutes                         | Instant restore / restore-branch promotion is near-immediate; the budget covers triage + verification. |
| **History window**                 | ≥ 7 days (Launch plan or higher)     | Configure under Settings → Instant restore once off the Free plan.                                     |
| **Off-platform backup**            | weekly `pg_dump`, retained ≥ 30 days | Manual or GitHub-Actions-scheduled `pg_dump` to durable storage (§1.4).                                |

The Free plan's fixed 6-hour window does **not** meet the ≥ 7-day target — treat
upgrading to a paid plan (and raising the history window) as a prerequisite for a
production launch.

### 1.3 Recovery procedure (instant restore / PITR)

When data is corrupted or wrongly deleted **within the history window**:

1. **Stop the bleeding.** If a bad deploy is the cause, roll the app back first
   via Vercel → Deployments → promote the last green deployment
   (`VERCEL_SETUP.md` §5). Note: app rollback does **not** roll back the database.
2. **Pick the restore timestamp** — just before the incident. Cross-reference the
   `[…][ALERT]` logs and `/api/health` (§2) to bound when things went wrong.
3. **Restore in the Neon Console**:
   - _Lower-risk path (recommended):_ create a **restore branch** at the target
     timestamp, point a throwaway connection string at it, and verify the data
     looks right (e.g. the `Report`/`User` tables) **before** cutting over.
   - _Direct path:_ use **instant restore** to roll the primary branch back to the
     target timestamp. This reverts the live branch — confirm the timestamp first.
4. **Re-point the app** if you restored onto a new branch: update `DATABASE_URL`
   in Vercel (Settings → Environment Variables) to the restored branch's pooled
   connection string, then redeploy.
5. **Verify** using `VERCEL_SETUP.md` §4 (hit `/api/health`, file a test report,
   confirm a row lands in `Report`).
6. **Re-apply migrations if needed.** Migrations are additive (`VERCEL_SETUP.md`
   §5), so a restored older snapshot may be missing recent schema. Run
   `npx prisma migrate deploy` against the restored branch.

### 1.4 Off-platform backup (`pg_dump`)

For recovery beyond the history window, or an exportable copy:

```bash
cd nexa
# Full logical dump (custom format → compact, parallel-restorable):
DATABASE_URL="<Neon pooled connection string>" \
  pg_dump "$DATABASE_URL" --format=custom --file="nexa-$(date +%F).dump"

# Restore into a fresh/empty database:
pg_restore --clean --if-exists --no-owner \
  --dbname="<target connection string>" "nexa-2026-01-01.dump"
```

Automate it (recommended for a real launch): a scheduled **GitHub Actions** job
that runs the dump and uploads to durable object storage (e.g. S3 / R2 — the same
credentials already documented for image storage in `.env.example`), with a
retention policy of ≥ 30 days. Keep dumps encrypted and access-restricted; they
contain user PII.

---

## 2. Error tracking / APM

### 2.1 Current baseline (already in the codebase)

Two production signals exist today and remain the **source of truth**:

- **`[…][ALERT]` console logs** — recognizable prefixes that an external log
  monitor can alert on. The status-polling cron logs `[poll-status][ALERT]` for
  per-report failures, push-notify failures, an unhealthy run
  (`errorCount/checked` over threshold), and crashes
  (`src/app/api/cron/poll-status/route.ts`).
- **`/api/health` DB probe** — a liveness + readiness endpoint that runs a
  bounded `SELECT 1` and returns `503 db_unreachable` when the database is down,
  logging `[health] DB probe failed` (`src/app/api/health/route.ts`). Point an
  uptime monitor (Vercel / UptimeRobot) at it.

Set up alerting on top of these: a Vercel Log Drain (or your log platform) with an
alert rule matching the `[ALERT]` substring, and an uptime monitor on
`/api/health`.

### 2.2 Recommended aggregator: Sentry (env-gated, code-complete)

The baseline above has no aggregation, deduplication, or notification thresholds.
The recommended next step is **Sentry for Next.js** (`@sentry/nextjs`), which
hooks Next's native instrumentation to capture uncaught server errors, group them,
and notify.

A **minimal, env-gated hook is already wired** in `src/instrumentation.ts`,
mirroring the no-op-when-unset convention used for push / email / S3:

- It is a **NO-OP unless `SENTRY_DSN` is set** — the app runs unchanged out of the
  box, and the `[…][ALERT]` logs remain the baseline.
- When `SENTRY_DSN` is set, Next's `register()` initializes Sentry and
  `onRequestError()` forwards uncaught server errors to Sentry **in addition to**
  the existing logs.
- `@sentry/nextjs` is an **optional dependency**, imported dynamically only when a
  DSN is present. If the DSN is set but the package is not installed, the hook
  logs `[instrumentation][ALERT]` and degrades to console logging rather than
  failing the build. This keeps the default install lean.

`SENTRY_DSN` is read through `src/lib/config.ts` (`getSentryDsn`) and documented
in `.env.example`.

### 2.3 Activating Sentry

1. Create a Sentry project (platform: **Next.js**) and copy its **DSN** from
   Settings → Client Keys (DSN). The DSN is a public, non-secret identifier.
2. Install the SDK:
   ```bash
   cd nexa
   npm install @sentry/nextjs
   ```
3. Set `SENTRY_DSN` in Vercel (Settings → Environment Variables) for Production
   (and Preview if desired), then redeploy. The hook in `src/instrumentation.ts`
   activates automatically — no further wiring required.
4. _(Optional)_ tune `tracesSampleRate` in `src/instrumentation.ts` (currently `0`,
   i.e. error-only, no performance tracing) and add client-side capture via
   `instrumentation-client.ts` if you want browser errors too.
5. Configure alert rules / notification thresholds in the Sentry dashboard.
