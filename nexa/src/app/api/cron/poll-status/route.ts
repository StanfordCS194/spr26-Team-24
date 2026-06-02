import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { IntakeMethod, ReportStatus } from "@/generated/prisma/enums";
import {
  fetchOpen311Status,
  parseOpen311Config,
  STATUS_RANK,
} from "@/lib/submission/open311";

// GET /api/cron/poll-status
//
// Status polling service (issue #37). Intended to run on a schedule (e.g. a
// Vercel Cron entry in vercel.json). For every report that has been submitted
// to an Open311 agency and isn't yet in a terminal state, it queries the
// endpoint for the latest status and advances the report's lifecycle.
//
// Protected by CRON_SECRET: callers must send `Authorization: Bearer <secret>`.
// Vercel Cron automatically attaches this header when CRON_SECRET is set.

// States we still expect updates for. RESOLVED/CLOSED are terminal, so we stop
// polling them to keep the job cheap.
const TRACKABLE_STATUSES: ReportStatus[] = [
  ReportStatus.SUBMITTED,
  ReportStatus.ACKNOWLEDGED,
  ReportStatus.IN_PROGRESS,
];

// Cap work per invocation so a backlog can't blow the cron timeout.
const MAX_PER_RUN = 100;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }
  }

  try {
    const reports = await prisma.report.findMany({
      where: {
        status: { in: TRACKABLE_STATUSES },
        externalTrackingId: { not: null },
        agency: { intakeMethod: IntakeMethod.API },
      },
      include: { agency: true },
      take: MAX_PER_RUN,
      orderBy: { updatedAt: "asc" },
    });

    let checked = 0;
    let updated = 0;
    let errors = 0;

    for (const report of reports) {
      if (!report.agency || !report.externalTrackingId) continue;
      checked++;

      const config = parseOpen311Config(report.agency.requiredFields);
      const result = await fetchOpen311Status(report.externalTrackingId, {
        config,
        intakeUrl: report.agency.intakeUrl,
      });

      if (result.status !== "ok" || !result.reportStatus) {
        if (result.status === "error") errors++;
        continue;
      }

      // Never regress: only advance to a status strictly later in the lifecycle.
      if (STATUS_RANK[result.reportStatus] <= STATUS_RANK[report.status]) {
        continue;
      }

      await prisma.report.update({
        where: { id: report.id },
        data: { status: result.reportStatus },
      });
      updated++;
    }

    return NextResponse.json({ checked, updated, errors });
  } catch (error) {
    console.error("Status poll error:", error);
    return NextResponse.json(
      { error: "Status polling failed." },
      { status: 500 },
    );
  }
}
