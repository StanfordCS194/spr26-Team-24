# Time-to-submit metric snapshot

Tracks the **capture → submit** latency of the report flow against the
O1.KR2 / K2 service-level objectives.

## Definition

- **Source event:** `report_submitted` (PostHog), property `time_to_submit_ms`.
- **Interval:** from the user's first capture action (first photo, or first
  keystroke of the description) through the report being **actually filed with
  the agency** (a real API/EMAIL submission). This span **includes**
  classification latency, matching the OKR definition of capture → submitted.
- **Emit point (#240):** `report_submitted` fires when the agency submission
  succeeds — `SubmissionAssistant` (`src/components/report/submission-assistant.tsx`)
  observes the `POST /api/reports/[id]/submit` response with `submitted=true`.
  It does **not** fire at report creation/CONFIRMED, and it does **not** fire for
  manual-assist (WEB_FORM/PHONE) agencies, whose reports stay CONFIRMED and are
  never auto-submitted. Earlier the timed event was emitted in the report-page
  create `onSuccess`, which measured capture → CONFIRMED and over-counted
  manual-assist reports; that path now emits `report_created` instead.
- **Stage events:** `report_classified` fires when classification completes and
  `report_created` fires when the report row is created/CONFIRMED, so the
  capture → classify, classify → create, and create → submit sub-stages remain
  queryable. `report_created` carries `time_to_confirm_ms` (capture → CONFIRMED)
  but is intentionally NOT the timed K2 event.

These event names and property keys are the ones actually emitted by the app —
see `src/app/report/page.tsx` (`report_classified`, `report_created`) and
`src/components/report/submission-assistant.tsx`
(`posthog?.capture("report_submitted", { … time_to_submit_ms … })`). The clock
(`flowStartedAt`) is started by `markCaptureStart()` on the first photo or first
description keystroke and threaded through to the submission assistant. The event
payloads are:

| Event               | Properties                                                                             |
| ------------------- | -------------------------------------------------------------------------------------- |
| `report_submitted`  | `report_id`, `issue_type`, `time_to_submit_ms`, `has_image`, `has_location`, `offline` |
| `report_created`    | `report_id`, `issue_type`, `time_to_confirm_ms`, `has_image`, `has_location`           |
| `report_classified` | `issue_type`, `severity`, `has_image`, `has_location`                                  |

### Offline submissions (#237)

`report_submitted` is emitted for offline-queued reports too: when an
offline-parked report is successfully **replayed** on reconnect,
`src/lib/offline-queue.ts` `flushQueue()` emits the same `report_submitted`
event with `time_to_submit_ms` measured from first capture → successful replay
(the capture-start timestamp is persisted with the queued item) and an
`offline: true` flag so the offline cohort can be filtered in or out of the read
independently. This closes the gap where offline reports — a core PWA field-use
case — were excluded from the K2 median/p90. The online path is unchanged.

PostHog is initialised in `src/components/posthog-provider.tsx` against host
`NEXT_PUBLIC_POSTHOG_HOST` (default `https://us.i.posthog.com`) with project key
`NEXT_PUBLIC_POSTHOG_KEY`. Instrumentation is a no-op when the key is unset, so
readings can only be collected from an environment that has the key configured
(production / preview).

## Targets (SLO)

| Statistic | Target                |
| --------- | --------------------- |
| Median    | <= 60 s (60 000 ms)   |
| p90       | <= 180 s (180 000 ms) |

## Reading median / p90 from PostHog

There are two equivalent ways to read the percentiles. Both operate on the
`report_submitted` event's `time_to_submit_ms` property.

### Option A — HogQL via the Query API (scriptable, reproducible)

PostHog exposes a SQL-like Query API. The query below returns count, median, and
p90 of `time_to_submit_ms` over the last 30 days. `quantile(0.9)` is p90;
`median(x)` is `quantile(0.5)`.

```sql
SELECT
  count()                                   AS n,
  median(toFloat(properties.time_to_submit_ms))      AS median_ms,
  quantile(0.9)(toFloat(properties.time_to_submit_ms)) AS p90_ms
FROM events
WHERE event = 'report_submitted'
  AND timestamp > now() - INTERVAL 30 DAY
  AND properties.time_to_submit_ms IS NOT NULL
```

Run it against the Query API (substitute your project id, region host, and a
**personal API key** with `query:read` scope — do NOT use the public
`NEXT_PUBLIC_POSTHOG_KEY`, and never commit the personal key):

```bash
curl -s "https://us.posthog.com/api/projects/<PROJECT_ID>/query/" \
  -H "Authorization: Bearer $POSTHOG_PERSONAL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
        "query": {
          "kind": "HogQLQuery",
          "query": "SELECT count() AS n, median(toFloat(properties.time_to_submit_ms)) AS median_ms, quantile(0.9)(toFloat(properties.time_to_submit_ms)) AS p90_ms FROM events WHERE event = '\''report_submitted'\'' AND timestamp > now() - INTERVAL 30 DAY AND properties.time_to_submit_ms IS NOT NULL"
        }
      }'
```

The response `results` row is `[n, median_ms, p90_ms]`. Divide the millisecond
values by 1000 to compare against the 60 s / 180 s targets. (The API host is the
**app** host — `us.posthog.com` / `eu.posthog.com` — not the ingestion host
`us.i.posthog.com` used by the browser SDK.)

### Option B — saved insight in the PostHog UI

1. New insight → **Trends**.
2. Series: event `report_submitted`.
3. Change the aggregation (the "Total count" dropdown on the series) to
   **Property value → P50** of `time_to_submit_ms`; add a second series with
   **P90** of the same property.
4. Set the date range (e.g. last 30 days) and save the insight to a dashboard.
5. Optionally add a goal/marker line at 60 000 and 180 000 ms for the SLO.

Read the P50 and P90 values straight off the chart for the snapshot table.

## PostHog dashboard

> Manual step (out of code scope): create a saved PostHog insight/dashboard
> computing median and p90 of `time_to_submit_ms` from `report_submitted` (see
> Option B above), with the 60s/180s SLO lines marked, then paste the link below.

- Dashboard link: _TODO — paste the committed PostHog dashboard URL here._

## Reproducible internal measurement (`e2e/k2-measure.spec.ts`)

For a reproducible reading that does not need a live PostHog instance, the
`k2-measure` Playwright project drives the real guest
capture → classify → review → submit → confirmation flow `K2_RUNS` times
(default 15) and reads the **literal** `time_to_submit_ms` the app emits — it
intercepts the PostHog capture payload via a measurement-only `capture` tap
(`window.__phEvents`, gated on `NEXT_PUBLIC_POSTHOG_CAPTURE_DEBUG`, set only by
`playwright.config.ts`; a no-op in production) — then computes median + p90. It
is kept **out** of the default CI e2e project so it never slows or destabilises
CI. Run it explicitly:

```bash
npx playwright test --project=k2-measure
# or with a larger sample:
K2_RUNS=25 npx playwright test --project=k2-measure
```

## Snapshot

> **Honest caveat — read this with the numbers.** Internal/prototype automated
> runs PASS (median/p90 << 60s/180s); these EXCLUDE real LLM latency
> (classifyWithConsensus mean 5,471 ms baseline / 7,302 ms two-stage per
> `eval/results/SUMMARY.md`); realistic end-to-end ≈6-10 s (still passes); true
> production K2 needs the documented HogQL read (`NEXT_PUBLIC_POSTHOG_KEY` must
> be set) and is biased online-only until #237 is fixed (now fixed by the
> offline-replay emit above).
>
> The row below is the measured internal-run reading from
> `e2e/k2-measure.spec.ts` (every network call stubbed, so it reflects UI /
> transition time only). For the live-traffic snapshot, run Option A or read
> Option B against PostHog and add a dated row — do **not** fabricate those
> values.

| Date (UTC) | n      | Median (ms) | p90 (ms) | Median <= 60s? | p90 <= 180s? | Notes                                                                                     |
| ---------- | ------ | ----------- | -------- | -------------- | ------------ | ----------------------------------------------------------------------------------------- |
| 2026-06-10 | 15     | 388         | 400      | yes            | yes          | Internal `e2e/k2-measure.spec.ts` run (stubbed network; excludes LLM latency, see caveat) |
| _TODO_     | _TODO_ | _TODO_      | _TODO_   | _TODO_         | _TODO_       | Live PostHog read (Option A/B) — fill from production traffic                             |
