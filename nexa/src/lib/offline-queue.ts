// Offline report queue (PWA work, issue #41). When a report is submitted
// without connectivity, its payload is parked in localStorage and replayed to
// /api/reports once the browser reports it is back online.

import posthog from "posthog-js";

const STORAGE_KEY = "nexa:offline-report-queue";

export interface QueuedReport {
  id: string;
  payload: Record<string, unknown>;
  queuedAt: number;
  // First-capture timestamp (the report page's `flowStartedAt`) at the moment
  // the report was queued. Persisted so a successfully REPLAYED report can emit
  // the same K2 `time_to_submit_ms` (first capture -> successful submit) that an
  // online submit emits — see flushQueue (#237). Optional for back-compat with
  // items queued before this field existed; flushQueue falls back to `queuedAt`.
  captureStartedAt?: number;
}

// Shape of the create route's success response we need on replay: the new row's
// id, surfaced as `report_id` on the emitted `report_submitted` event so an
// offline-replayed report joins the same K2 analysis as an online one.
interface CreatedReportResponse {
  success?: boolean;
  data?: { id?: string };
}

function read(): QueuedReport[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as QueuedReport[]) : [];
  } catch {
    return [];
  }
}

function write(items: QueuedReport[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // Storage full or unavailable — nothing more we can do here.
  }
}

export function queueReport(
  payload: Record<string, unknown>,
  // The report page's first-capture timestamp (`flowStartedAt`). Threaded
  // through so a replayed report can emit the K2 `time_to_submit_ms` measured
  // from first capture -> successful replay. Omitted/0 is tolerated; flushQueue
  // then falls back to `queuedAt` so an offline report is never silently
  // excluded from the metric (#237).
  captureStartedAt?: number,
): QueuedReport {
  const item: QueuedReport = {
    id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    payload,
    queuedAt: Date.now(),
    ...(captureStartedAt ? { captureStartedAt } : {}),
  };
  write([...read(), item]);
  return item;
}

export function getQueuedCount(): number {
  return read().length;
}

/** Replays every queued report; keeps the ones that still fail. Returns the count submitted. */
export async function flushQueue(): Promise<number> {
  if (typeof window === "undefined" || !navigator.onLine) return 0;

  const items = read();
  if (items.length === 0) return 0;

  const remaining: QueuedReport[] = [];
  let flushed = 0;

  for (const item of items) {
    try {
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(item.payload),
      });
      if (res.ok) {
        flushed += 1;
        await emitReplaySubmitted(item, res);
      } else {
        remaining.push(item);
      }
    } catch {
      remaining.push(item);
    }
  }

  write(remaining);
  return flushed;
}

/**
 * Emit the K2 `report_submitted` event for a report that was queued offline and
 * has now successfully replayed (#237). This is the SAME PostHog event and
 * `time_to_submit_ms` property the online submit emits — not a parallel
 * analytics path — so offline reports land in the identical median/p90.
 *
 * `time_to_submit_ms` is measured first capture -> successful replay using the
 * persisted `captureStartedAt`; when that is missing (an item queued before the
 * field existed) we fall back to `queuedAt` so the report is never silently
 * excluded. `offline: true` flags these so they can be analyzed separately from
 * the (network-instant) online path.
 */
async function emitReplaySubmitted(
  item: QueuedReport,
  res: Response,
): Promise<void> {
  // No-op when PostHog isn't initialised (e.g. NEXT_PUBLIC_POSTHOG_KEY unset),
  // mirroring the rest of the app's instrumentation.
  if (!posthog.__loaded) return;

  const captureStart = item.captureStartedAt ?? item.queuedAt;

  // The create succeeded (res.ok); reading the body only adds the new row's id.
  // If parsing fails we still emit — without report_id — so the offline submit
  // is never silently dropped from the K2 count.
  let reportId: string | undefined;
  try {
    const body = (await res.clone().json()) as CreatedReportResponse;
    reportId = body?.data?.id;
  } catch {
    reportId = undefined;
  }

  posthog.capture("report_submitted", {
    ...(reportId ? { report_id: reportId } : {}),
    issue_type: item.payload.issueType,
    time_to_submit_ms: Date.now() - captureStart,
    has_image: !!item.payload.imageUrl,
    has_location: item.payload.latitude != null,
    // Flag offline-replayed submissions so they can be filtered in or out of the
    // K2 read independently of the (network-instant) online path.
    offline: true,
  });
}
