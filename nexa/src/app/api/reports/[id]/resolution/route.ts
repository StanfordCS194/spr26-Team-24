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

    // Shared resolution: when a report that belongs to an IssueGroup is marked
    // resolved, the whole case resolves for every reporter linked to it. The
    // group is flagged resolved and every non-closed member report is updated to
    // match. Reports with no group keep the single-report behavior below.
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
            status: { not: "CLOSED" },
          },
          data: {
            userResolved: true,
            userResolvedAt: resolvedAt,
            status: "RESOLVED",
          },
        }),
      ]);

      return successResponse({
        id: report.id,
        userResolved: true,
        status: report.status === "CLOSED" ? "CLOSED" : "RESOLVED",
      });
    }

    const nextStatus =
      resolved && report.status !== "CLOSED" ? "RESOLVED" : report.status;

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
