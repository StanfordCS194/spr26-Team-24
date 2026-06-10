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
//
// Fail closed: if CRON_SECRET is unset/empty we refuse the request (503) and do
// NOT poll, so a missing secret can never expose this endpoint to unauthenticated
// callers triggering external Open311 traffic (#99).

// States we still expect updates for. RESOLVED/CLOSED are terminal, so we stop
// polling them to keep the job cheap.
const TRACKABLE_STATUSES: ReportStatus[] = [
  ReportStatus.SUBMITTED,
  ReportStatus.ACKNOWLEDGED,
  ReportStatus.IN_PROGRESS,
];

// Cap work per invocation so a backlog can't blow the cron timeout.
const MAX_PER_RUN = 100;

// Prefix every operational failure line with this token so an external log
// monitor (Vercel log drains, Logflare, a grep-based alert, etc.) can match on
// it and alert. Kept deliberately greppable — see the PR for the alerting hook.
const ALERT_PREFIX = "[poll-status][ALERT]";

// When at least this share of the reports we attempted fail, the run is treated
// as unhealthy and the route returns 503 so Vercel Cron records a failure rather
// than a silent partial success. Below the threshold we still report the count
// but return 200, since a few transient per-report errors are expected.
const ERROR_RATE_THRESHOLD = 0.5;

// One structured failure record per report we couldn't poll.
type ReportFailure = {
  reportId: string;
  serviceRequestId: string | null;
  httpStatus: number | null;
  reason: string;
};

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  // Fail closed: without a configured secret there is no way to authenticate the
  // caller, so refuse rather than run polling unauthenticated.
  if (!secret) {
    return NextResponse.json(
      { error: "Cron polling is not configured." },
      { status: 503 },
    );
  }
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
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
    const failures: ReportFailure[] = [];

    for (const report of reports) {
      if (!report.agency || !report.externalTrackingId) continue;
      checked++;

      const config = parseOpen311Config(report.agency.requiredFields);
      const result = await fetchOpen311Status(report.externalTrackingId, {
        config,
        intakeUrl: report.agency.intakeUrl,
      });

      if (result.status !== "ok" || !result.reportStatus) {
        if (result.status === "error") {
          // Structured, per-report failure log: report id + service request id
          // + HTTP status + reason, so a failed poll is traceable from the logs.
          const failure: ReportFailure = {
            reportId: report.id,
            serviceRequestId: report.externalTrackingId,
            httpStatus: result.httpStatus,
            reason: result.message,
          };
          failures.push(failure);
          console.error(`${ALERT_PREFIX} report poll failed`, failure);
        }
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

    const errors = failures.length;
    // Treat the run as unhealthy when too large a share of attempts failed, so
    // Vercel Cron sees a non-2xx and the failure is observable. The summary is
    // always returned so callers can act on it regardless of status code.
    const errorRate = checked === 0 ? 0 : errors / checked;
    const ok = errorRate < ERROR_RATE_THRESHOLD;
    const summary = { checked, updated, errors, failures, ok };

    if (!ok) {
      console.error(
        `${ALERT_PREFIX} run unhealthy: ${errors}/${checked} reports failed`,
      );
      return NextResponse.json(summary, { status: 503 });
    }

    return NextResponse.json(summary);
  } catch (error) {
    // Whole-run failure (e.g. DB unreachable): emit the alert prefix too so the
    // same monitor catches a total outage, not just per-report failures.
    console.error(`${ALERT_PREFIX} status poll crashed:`, error);
    return NextResponse.json(
      { error: "Status polling failed." },
      { status: 500 },
    );
  }
}
