// Small pure presentation helpers for the admin analytics dashboard.
// Kept separate from the aggregation so they can be unit-tested without a DB,
// and locale-agnostic (the units are abbreviations the UI labels around).

/**
 * Format a fraction in [0,1] as a percentage string with one decimal, e.g.
 * `0.8423 -> "84.2%"`. Clamps NaN to `0.0%`.
 */
export function formatPercent(fraction: number): string {
  const safe = Number.isFinite(fraction) ? fraction : 0;
  return `${(safe * 100).toFixed(1)}%`;
}

/**
 * Format a whole-second duration compactly using the largest sensible unit:
 * seconds (<60s), minutes (<60m), hours (<24h), then days. Returns an em dash
 * for a null/negative/non-finite input so "no data" renders cleanly.
 */
export function formatDurationSeconds(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return "—";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = seconds / 60;
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const hours = minutes / 60;
  if (hours < 24) return `${hours.toFixed(1)}h`;
  const days = hours / 24;
  return `${days.toFixed(1)}d`;
}
