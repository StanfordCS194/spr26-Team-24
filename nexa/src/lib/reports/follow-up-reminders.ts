import { prisma } from "@/lib/prisma";
import {
  FOLLOW_UP_REMINDER_STALE_DAYS,
  isReportEligibleForFollowUpReminder,
} from "@/lib/reports/follow-up";

export interface StaleReportReminderCandidate {
  id: string;
  issueType: string | null;
  status: string;
  description: string | null;
  aiDescription: string | null;
  address: string | null;
  externalTrackingId: string | null;
  createdAt: Date;
  updatedAt: Date;
  user: {
    email: string;
    name: string | null;
  } | null;
}

export async function findStaleUnresolvedReportsForFollowUp(options?: {
  staleDays?: number;
  now?: Date;
}): Promise<StaleReportReminderCandidate[]> {
  const staleDays = options?.staleDays ?? FOLLOW_UP_REMINDER_STALE_DAYS;
  const now = options?.now ?? new Date();
  const cutoff = new Date(now.getTime() - staleDays * 24 * 60 * 60 * 1000);

  const reports = await prisma.report.findMany({
    where: {
      status: { notIn: ["RESOLVED", "CLOSED"] },
      userId: { not: null },
      user: { is: { email: { not: "" } } },
      updatedAt: { lte: cutoff },
    },
    orderBy: { updatedAt: "asc" },
    select: {
      id: true,
      issueType: true,
      status: true,
      description: true,
      aiDescription: true,
      address: true,
      externalTrackingId: true,
      createdAt: true,
      updatedAt: true,
      user: {
        select: {
          email: true,
          name: true,
        },
      },
    },
  });

  return reports.filter((report) =>
    isReportEligibleForFollowUpReminder(report, now, staleDays),
  );
}
