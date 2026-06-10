import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { successResponse, errorResponse } from "@/lib/api/response";

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSession();
    if (!session) {
      return errorResponse("Not authenticated.", 401);
    }

    const { id } = await context.params;

    const report = await prisma.report.findUnique({
      where: { id },
      select: { id: true, userId: true, issueGroupId: true },
    });

    if (!report) {
      return errorResponse("Report not found.", 404);
    }

    if (report.userId !== session.userId) {
      return errorResponse("You can only delete your own reports.", 403);
    }

    // Delete the report and keep its IssueGroup consistent: a stale reportCount
    // or an orphaned (now empty) group would otherwise linger as a ghost pin on
    // the community map. Recompute the surviving members' count and centroid, or
    // drop the group entirely when its last report is removed.
    await prisma.$transaction(async (tx) => {
      await tx.report.delete({ where: { id } });

      if (!report.issueGroupId) return;

      const members = await tx.report.findMany({
        where: { issueGroupId: report.issueGroupId },
        select: { latitude: true, longitude: true },
      });

      if (members.length === 0) {
        await tx.issueGroup.delete({ where: { id: report.issueGroupId } });
        return;
      }

      const located = members.filter(
        (m): m is { latitude: number; longitude: number } =>
          typeof m.latitude === "number" && typeof m.longitude === "number",
      );
      const data: {
        reportCount: number;
        latitude?: number;
        longitude?: number;
      } = { reportCount: members.length };
      if (located.length > 0) {
        data.latitude =
          located.reduce((sum, m) => sum + m.latitude, 0) / located.length;
        data.longitude =
          located.reduce((sum, m) => sum + m.longitude, 0) / located.length;
      }

      await tx.issueGroup.update({
        where: { id: report.issueGroupId },
        data,
      });
    });

    return successResponse({ deleted: true });
  } catch (error) {
    console.error("Report deletion error:", error);
    return errorResponse("Failed to delete report. Please try again.", 500);
  }
}
