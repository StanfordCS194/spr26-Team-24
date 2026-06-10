// Tracks the server ids of reports a visitor filed while signed out, so that
// when they later create/claim an account we can hand those ids to
// `/api/auth/claim` and re-associate the reports with the new account. This is
// the client half of the anonymous-reporting upgrade path; the server half is
// the `reportIds` handling in `POST /api/auth/claim`.

const STORAGE_KEY = "nexa-pending-report-ids";

function read(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === "string")
      : [];
  } catch {
    return [];
  }
}

function write(ids: string[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
}

/** Returns the ids of anonymous reports awaiting account association. */
export function getPendingReportIds(): string[] {
  return read();
}

/** Records an anonymous report id (deduped) to be claimed after sign-up. */
export function addPendingReportId(id: string) {
  if (!id) return;
  const ids = read();
  if (ids.includes(id)) return;
  ids.push(id);
  write(ids);
}

/** Clears the pending list once the reports have been claimed. */
export function clearPendingReportIds() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
}
