# Time-to-submit metric snapshot

Tracks the **capture → submit** latency of the report flow against the
O1.KR2 / K2 service-level objectives.

## Definition

- **Source event:** `report_submitted` (PostHog), property `time_to_submit_ms`.
- **Interval:** from the user's first capture action (first photo, or first
  keystroke of the description) through a successful submit. This span
  **includes** classification latency, matching the OKR definition of
  capture → submitted.
- **Stage event:** `report_classified` fires when classification completes, so
  the capture → classify and classify → submit sub-stages remain queryable.

These event names and property keys are the ones actually emitted by the app —
see `src/app/report/page.tsx` (`posthog?.capture("report_classified", …)` and
`posthog?.capture("report_submitted", { … time_to_submit_ms … })`). The clock
(`flowStartedAt`) is started by `markCaptureStart()` on the first photo or first
description keystroke. The event payloads are:

| Event               | Properties                                                                  |
| ------------------- | --------------------------------------------------------------------------- |
| `report_submitted`  | `report_id`, `issue_type`, `time_to_submit_ms`, `has_image`, `has_location` |
| `report_classified` | `issue_type`, `severity`, `has_image`, `has_location`                       |

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

## Snapshot

> **Remaining manual / ops action.** Populating this table requires the live
> PostHog instance plus a real sample (>= 10 P0 test reports submitted end-to-end
> so the percentiles are meaningful). That is a human/ops step — do **not**
> fabricate values. Run Option A or read Option B, then add a dated row below.
> Add a new row each time the snapshot is refreshed (e.g. in the weekly eval
> summary). Fill the "met?" columns from the values vs the SLO targets.

| Date (UTC) | n      | Median (ms) | p90 (ms) | Median <= 60s? | p90 <= 180s? | Notes  |
| ---------- | ------ | ----------- | -------- | -------------- | ------------ | ------ |
| _TODO_     | _TODO_ | _TODO_      | _TODO_   | _TODO_         | _TODO_       | _TODO_ |
