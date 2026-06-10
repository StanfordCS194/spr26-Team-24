import { NextRequest } from "next/server";
import { sendReportFollowUpReminderEmail } from "@/lib/email";
import { FOLLOW_UP_REMINDER_STALE_DAYS } from "@/lib/reports/follow-up";
import { findStaleUnresolvedReportsForFollowUp } from "@/lib/reports/follow-up-reminders";
import { successResponse, errorResponse } from "@/lib/api/response";

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.FOLLOW_UP_REMINDER_SECRET;
  if (!secret) return false;

  const headerSecret = request.headers.get("x-follow-up-reminder-secret");
  const bearer = request.headers.get("authorization")?.replace(/^Bearer /i, "");
  return headerSecret === secret || bearer === secret;
}

function parsePositiveInteger(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

export async function POST(request: NextRequest) {
  if (!process.env.FOLLOW_UP_REMINDER_SECRET) {
    return errorResponse(
      "FOLLOW_UP_REMINDER_SECRET is not configured. Set it before running reminders.",
      500,
    );
  }

  if (!isAuthorized(request)) {
    return errorResponse("Not authorized.", 401);
  }

  const staleDays =
    parsePositiveInteger(request.nextUrl.searchParams.get("days")) ??
    FOLLOW_UP_REMINDER_STALE_DAYS;
  const dryRun = request.nextUrl.searchParams.get("dryRun") !== "false";

  if (!dryRun && !process.env.BREVO_API_KEY) {
    return errorResponse(
      "BREVO_API_KEY is not configured. Run with dryRun=true or configure Brevo before sending reminders.",
      500,
    );
  }

  let candidates;
  try {
    candidates = await findStaleUnresolvedReportsForFollowUp({
      staleDays,
    });
  } catch (error) {
    console.error("Follow-up reminder lookup error:", error);
    return errorResponse("Failed to look up eligible reports.", 500);
  }

  const result = {
    staleDays,
    dryRun,
    eligibleReports: candidates.length,
    sent: 0,
    skipped: 0,
    failures: [] as { reportId: string; error: string }[],
    note: "This route sends at most one reminder per eligible report per invocation. Persistent cross-run deduplication would require a reminder log/table or timestamp field.",
  };

  if (dryRun) {
    result.skipped = candidates.length;
    return successResponse(result);
  }

  for (const report of candidates) {
    if (!report.user) {
      result.skipped += 1;
      continue;
    }

    try {
      await sendReportFollowUpReminderEmail(report.user, report);
      result.sent += 1;
    } catch (error) {
      result.failures.push({
        reportId: report.id,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  return successResponse(result);
}
