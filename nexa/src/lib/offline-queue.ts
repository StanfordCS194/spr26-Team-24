// Offline report queue (PWA work, issue #41). When a report is submitted
// without connectivity, its payload is parked in localStorage and replayed to
// /api/reports once the browser reports it is back online.

const STORAGE_KEY = "nexa:offline-report-queue";

export interface QueuedReport {
  id: string;
  payload: Record<string, unknown>;
  queuedAt: number;
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

export function queueReport(payload: Record<string, unknown>): QueuedReport {
  const item: QueuedReport = {
    id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    payload,
    queuedAt: Date.now(),
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
