import { beforeEach, describe, expect, it, vi } from "vitest";

import { IssueType, ReportStatus } from "@/generated/prisma/enums";
import { prismaMock } from "@/test/prisma-mock";

// The map is login-gated, so drive the session helper to cover authed/anon.
vi.mock("@/lib/auth", () => ({ getSession: vi.fn() }));
import { getSession } from "@/lib/auth";

import { GET } from "./route";

const mockedGetSession = vi.mocked(getSession);

/** Build an IssueGroup row as returned by the route's narrowed `select`. */
function makeGroupRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "group_1",
    latitude: 37.4419,
    longitude: -122.143,
    issueType: IssueType.ROAD_DAMAGE,
    status: ReportStatus.CONFIRMED,
    reportCount: 3,
    createdAt: new Date("2025-01-01T00:00:00.000Z"),
    reports: [] as { id: string }[],
    ...overrides,
  };
}

describe("GET /api/issues/map", () => {
  beforeEach(() => {
    mockedGetSession.mockReset();
    prismaMock.issueGroup.findMany.mockReset();
  });

  it("returns 401 when the caller is not authenticated", async () => {
    // Arrange
    mockedGetSession.mockResolvedValue(null);

    // Act
    const response = await GET();
    const body = await response.json();

    // Assert
    expect(response.status).toBe(401);
    expect(body).toEqual({ success: false, error: "Not authenticated." });
    expect(prismaMock.issueGroup.findMany).not.toHaveBeenCalled();
  });

  it("returns aggregated pins with the viewer's own report id attached", async () => {
    // Arrange
    mockedGetSession.mockResolvedValue({ userId: "viewer", email: "v@x.com" });
    prismaMock.issueGroup.findMany.mockResolvedValue([
      makeGroupRow({ id: "group_1", reports: [{ id: "my_report" }] }),
    ] as never);

    // Act
    const response = await GET();
    const body = await response.json();

    // Assert
    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.points).toHaveLength(1);
    expect(body.data.points[0]).toMatchObject({
      id: "group_1",
      latitude: 37.4419,
      longitude: -122.143,
      status: ReportStatus.CONFIRMED,
      reportCount: 3,
      myReportId: "my_report",
    });
    // The point carries a human label and a relative-time string.
    expect(typeof body.data.points[0].issueLabel).toBe("string");
    expect(typeof body.data.points[0].relativeTime).toBe("string");
  });

  it("sets myReportId to null when the viewer filed nothing in the group", async () => {
    // Arrange
    mockedGetSession.mockResolvedValue({ userId: "viewer", email: "v@x.com" });
    prismaMock.issueGroup.findMany.mockResolvedValue([
      makeGroupRow({ reports: [] }),
    ] as never);

    // Act
    const response = await GET();
    const body = await response.json();

    // Assert
    expect(response.status).toBe(200);
    expect(body.data.points[0].myReportId).toBeNull();
  });

  it("returns an empty points array when there are no issue groups", async () => {
    // Arrange
    mockedGetSession.mockResolvedValue({ userId: "viewer", email: "v@x.com" });
    prismaMock.issueGroup.findMany.mockResolvedValue([] as never);

    // Act
    const response = await GET();
    const body = await response.json();

    // Assert
    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true, data: { points: [] } });
  });
});
