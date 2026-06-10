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

  // Number the pins by when each issue was first filed (1 = earliest), so the
  // map is sequenced like the dashboard. Computed independently of the display
  // order above (which is most-recently-active first).
  const orderByGroupId = new Map(
    [...groups]
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((group, index) => [group.id, index + 1] as const),
  );

  return groups.map((group) => ({
    id: group.id,
    latitude: group.latitude,
    longitude: group.longitude,
    issueType: group.issueType,
    issueLabel:
      ISSUE_TYPE_LABELS[group.issueType] || group.issueType || "Uncategorized",
    status: group.status,
    reportCount: group.reportCount,
    createdAt: group.createdAt.toISOString(),
    relativeTime: formatRelativeTime(group.createdAt),
    order: orderByGroupId.get(group.id) ?? 1,
    myReportId: group.reports[0]?.id ?? null,
  }));
}
