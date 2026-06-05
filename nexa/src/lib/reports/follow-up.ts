const MS_PER_DAY = 24 * 60 * 60 * 1000;

export const FOLLOW_UP_REMINDER_STALE_DAYS = 14;

const RESOLVED_STATUSES = new Set(["RESOLVED", "CLOSED"]);

export interface FollowUpReportLike {
  status: string;
  createdAt: Date;
  updatedAt?: Date | null;
}

export interface ReportFollowUpState {
  isUnresolved: boolean;
  isStale: boolean;
  ageDays: number;
  lastActivityAt: Date;
  label: "Awaiting response" | "Follow-up recommended" | "Resolved";
  description: string;
}

export function getReportFollowUpState(
  report: FollowUpReportLike,
  now = new Date(),
  staleDays = FOLLOW_UP_REMINDER_STALE_DAYS,
): ReportFollowUpState {
  const lastActivityAt = report.updatedAt ?? report.createdAt;
  const ageDays = Math.max(
    0,
    Math.floor((now.getTime() - lastActivityAt.getTime()) / MS_PER_DAY),
  );
  const isUnresolved = !RESOLVED_STATUSES.has(report.status);
  const isStale = isUnresolved && ageDays >= staleDays;

  if (!isUnresolved) {
    return {
      isUnresolved,
      isStale,
      ageDays,
      lastActivityAt,
      label: "Resolved",
      description:
        "This report is marked resolved or closed in Nexa's app-side tracking.",
    };
  }

  if (isStale) {
    return {
      isUnresolved,
      isStale,
      ageDays,
      lastActivityAt,
      label: "Follow-up recommended",
      description:
        "This reflects app-side tracking only. It does not confirm municipality action.",
    };
  }

  return {
    isUnresolved,
    isStale,
    ageDays,
    lastActivityAt,
    label: "Awaiting response",
    description:
      "This reflects app-side tracking only. It does not confirm municipality action.",
  };
}

export function isReportEligibleForFollowUpReminder(
  report: FollowUpReportLike,
  now = new Date(),
  staleDays = FOLLOW_UP_REMINDER_STALE_DAYS,
): boolean {
  return getReportFollowUpState(report, now, staleDays).isStale;
}
