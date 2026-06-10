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

## Targets (SLO)

| Statistic | Target                |
| --------- | --------------------- |
| Median    | <= 60 s (60 000 ms)   |
| p90       | <= 180 s (180 000 ms) |

## PostHog dashboard

> Manual step (out of code scope): create a saved PostHog insight/dashboard
> computing median and p90 of `time_to_submit_ms` from `report_submitted`, with
> the 60s/180s SLO lines marked, then paste the link below.

- Dashboard link: _TODO — paste the committed PostHog dashboard URL here._

## Snapshot

> Fill from real data — at least one midpoint reading from the >= 10 P0 test
> reports. Add a new row each time the snapshot is refreshed (e.g. in the
> weekly CI eval summary).

| Date (UTC) | n      | Median (ms) | p90 (ms) | Median <= 60s? | p90 <= 180s? | Notes  |
| ---------- | ------ | ----------- | -------- | -------------- | ------------ | ------ |
| _TODO_     | _TODO_ | _TODO_      | _TODO_   | _TODO_         | _TODO_       | _TODO_ |
