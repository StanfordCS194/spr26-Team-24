import { prisma } from "@/lib/prisma";
import { ISSUE_TYPE_LABELS } from "@/lib/constants";
import { formatRelativeTime } from "@/lib/utils";
import type { IssueMapPoint } from "@/components/map/community-map";

/**
 * Builds the community issue-map pin data: every IssueGroup as one point, with
 * the viewer's own report id (if any) attached so the UI can offer a per-pin
 * "Mark resolved" action. Shared by the /map page (initial render) and the
 * GET /api/issues/map endpoint (client refetches).
 */
export async function getIssueMapPoints(
  userId: string,
): Promise<IssueMapPoint[]> {
  const groups = await prisma.issueGroup.findMany({
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      latitude: true,
      longitude: true,
      issueType: true,
      status: true,
      reportCount: true,
      createdAt: true,
      reports: {
        where: { userId },
        select: { id: true },
        take: 1,
      },
    },
  });

  return groups.map((group) => ({
    id: group.id,
    latitude: group.latitude,
    longitude: group.longitude,
    issueLabel:
      ISSUE_TYPE_LABELS[group.issueType] || group.issueType || "Uncategorized",
    status: group.status,
    reportCount: group.reportCount,
    relativeTime: formatRelativeTime(group.createdAt),
    myReportId: group.reports[0]?.id ?? null,
  }));
}
