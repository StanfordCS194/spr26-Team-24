import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * "just now" / "5 minutes ago" / "yesterday" / "3 days ago" for recent times;
 * a short absolute date ("May 13", "May 13, 2025") for anything older than a week.
 */
export function formatRelativeTime(
  date: Date | string,
  locale = "en",
  justNow = "just now",
): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const relativeTimeFormat = new Intl.RelativeTimeFormat(locale, {
    numeric: "auto",
  });
  const diffSec = Math.round((d.getTime() - Date.now()) / 1000);
  const absSec = Math.abs(diffSec);

  if (absSec < 45) return justNow;
  if (absSec < 60 * 60) {
    return relativeTimeFormat.format(Math.round(diffSec / 60), "minute");
  }
  if (absSec < 60 * 60 * 24) {
    return relativeTimeFormat.format(Math.round(diffSec / 3600), "hour");
  }
  if (absSec < 60 * 60 * 24 * 7) {
    return relativeTimeFormat.format(Math.round(diffSec / 86400), "day");
  }

  const now = new Date();
  return d.toLocaleDateString(locale, {
    month: "short",
    day: "numeric",
    year: d.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
}

/** Full timestamp suitable for a tooltip / aria-label. */
export function formatFullDateTime(date: Date | string, locale = "en"): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleString(locale);
}
