import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { ResolutionSchema } from "@/lib/api/schemas";
import {
  parseJsonRequest,
  RequestParseError,
  parseErrorResponse,
} from "@/lib/api/request-parser";
import { successResponse, errorResponse } from "@/lib/api/response";
import { ReportStatus } from "@/generated/prisma/enums";
import {
  USER_RESOLVABLE_FROM,
  canTransition,
} from "@/lib/reports/status-machine";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSession();
    if (!session) {
      return errorResponse("Not authenticated.", 401);
    }

    const { id } = await context.params;
    const { resolved } = await parseJsonRequest(request, ResolutionSchema);

    const report = await prisma.report.findUnique({
      where: { id },
      select: { id: true, userId: true, status: true, issueGroupId: true },
    });

    if (!report) {
      return errorResponse("Report not found.", 404);
    }

    if (report.userId !== session.userId) {
      return errorResponse("You can only update your own reports.", 403);
    }

    const resolvedAt = new Date();

    // Status-machine guard (#104): a user may only mark a report RESOLVED once
    // it has at least reached SUBMITTED. Resolving a DRAFT / CLASSIFYING /
    // CONFIRMED / SUBMITTING report would bypass the submission flow, so reject
    // it rather than writing an illegal transition. Un-resolving (resolved =
    // false) never moves status, so it's always allowed.
    if (resolved && !USER_RESOLVABLE_FROM.includes(report.status)) {
      return errorResponse(
        "This report can't be marked resolved yet — it hasn't been submitted.",
        409,
        "INVALID_STATUS_TRANSITION",
      );
    }

    // Shared resolution: when a report that belongs to an IssueGroup is marked
    // resolved, the whole case resolves for every reporter linked to it. The
    // group is flagged resolved and every member report that is itself
    // user-resolvable is advanced to RESOLVED — members still pre-submission (or
    // already CLOSED) keep their status, so the case resolution never forces an
    // illegal transition on them.
    if (report.issueGroupId && resolved) {
      await prisma.$transaction([
        prisma.issueGroup.update({
          where: { id: report.issueGroupId },
          data: {
            status: "RESOLVED",
            resolvedAt,
            resolvedByUserId: session.userId,
          },
        }),
        prisma.report.updateMany({
          where: {
            issueGroupId: report.issueGroupId,
            status: { in: USER_RESOLVABLE_FROM },
          },
          data: {
            userResolved: true,
            userResolvedAt: resolvedAt,
            status: ReportStatus.RESOLVED,
          },
        }),
      ]);

      return successResponse({
        id: report.id,
        userResolved: true,
        status: ReportStatus.RESOLVED,
      });
    }

    // Single-report path. The guard above guarantees that when `resolved` is
    // true the report is in a user-resolvable status, so RESOLVED is always a
    // legal target here; this assertion documents that invariant.
    const nextStatus = resolved ? ReportStatus.RESOLVED : report.status;
    if (resolved && !canTransition(report.status, nextStatus)) {
      return errorResponse(
        "This report can't be marked resolved yet.",
        409,
        "INVALID_STATUS_TRANSITION",
      );
    }

    const updated = await prisma.report.update({
      where: { id },
      data: {
        userResolved: resolved,
        userResolvedAt: resolvedAt,
        status: nextStatus,
      },
      select: { id: true, userResolved: true, status: true },
    });

    return successResponse(updated);
  } catch (error) {
    if (error instanceof RequestParseError) {
      return parseErrorResponse(error);
    }
    console.error("Report resolution update error:", error);
    return errorResponse("Failed to update resolution. Please try again.", 500);
  }
}
