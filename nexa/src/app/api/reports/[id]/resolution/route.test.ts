import { NextRequest } from "next/server";
import { describe, expect, it, vi, beforeEach } from "vitest";

import { ReportStatus } from "@/generated/prisma/enums";
import { makeReport } from "@/test/factories/report";
import { prismaMock } from "@/test/prisma-mock";

const getSession = vi.fn();
vi.mock("@/lib/auth", () => ({
  getSession: () => getSession(),
}));

import { POST } from "./route";

beforeEach(() => {
  getSession.mockReset();
  getSession.mockResolvedValue({ userId: "user_1", email: "u@x.com" });
});

function postRequest(id: string, resolved: boolean): NextRequest {
  return new NextRequest(`http://localhost/api/reports/${id}/resolution`, {
    method: "POST",
    body: JSON.stringify({ resolved }),
  });
}

function call(id: string, resolved: boolean) {
  return POST(postRequest(id, resolved), {
    params: Promise.resolve({ id }),
  });
}

describe("POST /api/reports/[id]/resolution status guard (#104)", () => {
  it.each([
    ReportStatus.DRAFT,
    ReportStatus.CLASSIFYING,
    ReportStatus.CONFIRMED,
    ReportStatus.SUBMITTING,
  ])(
    "rejects resolving a pre-submission report (%s) with 409",
    async (status) => {
      const report = makeReport({
        id: "r1",
        userId: "user_1",
        status,
        issueGroupId: null,
      });
      prismaMock.report.findUnique.mockResolvedValue(report);

      const response = await call("r1", true);

      expect(response.status).toBe(409);
      const body = await response.json();
      expect(body.code).toBe("INVALID_STATUS_TRANSITION");
      // The illegal transition must never be written.
      expect(prismaMock.report.update).not.toHaveBeenCalled();
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    },
  );

  it.each([
    ReportStatus.SUBMITTED,
    ReportStatus.ACKNOWLEDGED,
    ReportStatus.IN_PROGRESS,
  ])("marks a post-submission report (%s) RESOLVED", async (status) => {
    const report = makeReport({
      id: "r1",
      userId: "user_1",
      status,
      issueGroupId: null,
    });
    prismaMock.report.findUnique.mockResolvedValue(report);
    prismaMock.report.update.mockResolvedValue({
      id: "r1",
      userResolved: true,
      status: ReportStatus.RESOLVED,
    } as Awaited<ReturnType<typeof prismaMock.report.update>>);

    const response = await call("r1", true);

    expect(response.status).toBe(200);
    expect(prismaMock.report.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: ReportStatus.RESOLVED }),
      }),
    );
  });

  it("un-resolving (resolved=false) never changes status, even pre-submission", async () => {
    const report = makeReport({
      id: "r1",
      userId: "user_1",
      status: ReportStatus.CONFIRMED,
      issueGroupId: null,
    });
    prismaMock.report.findUnique.mockResolvedValue(report);
    prismaMock.report.update.mockResolvedValue({
      id: "r1",
      userResolved: false,
      status: ReportStatus.CONFIRMED,
    } as Awaited<ReturnType<typeof prismaMock.report.update>>);

    const response = await call("r1", false);

    expect(response.status).toBe(200);
    expect(prismaMock.report.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: ReportStatus.CONFIRMED }),
      }),
    );
  });

  it("group resolution only advances user-resolvable members", async () => {
    const report = makeReport({
      id: "r1",
      userId: "user_1",
      status: ReportStatus.SUBMITTED,
      issueGroupId: "group_1",
    });
    prismaMock.report.findUnique.mockResolvedValue(report);
    prismaMock.$transaction.mockResolvedValue([]);

    const response = await call("r1", true);

    expect(response.status).toBe(200);
    expect(prismaMock.$transaction).toHaveBeenCalled();
    // The members updateMany must filter by the user-resolvable status set, not
    // merely "not CLOSED", so pre-submission members aren't forced to RESOLVED.
    const txArgs = prismaMock.report.updateMany.mock.calls[0]?.[0];
    expect(txArgs?.where?.status).toEqual({
      in: expect.arrayContaining([
        ReportStatus.SUBMITTED,
        ReportStatus.ACKNOWLEDGED,
        ReportStatus.IN_PROGRESS,
        ReportStatus.RESOLVED,
      ]),
    });
  });

  it("rejects resolving a CLOSED report with 409", async () => {
    const report = makeReport({
      id: "r1",
      userId: "user_1",
      status: ReportStatus.CLOSED,
      issueGroupId: null,
    });
    prismaMock.report.findUnique.mockResolvedValue(report);

    const response = await call("r1", true);

    expect(response.status).toBe(409);
    expect(prismaMock.report.update).not.toHaveBeenCalled();
  });

  it("returns 401 when there is no session", async () => {
    getSession.mockResolvedValue(null);

    const response = await call("r1", true);

    expect(response.status).toBe(401);
    expect(prismaMock.report.findUnique).not.toHaveBeenCalled();
  });

  it("returns 404 when the report does not exist", async () => {
    prismaMock.report.findUnique.mockResolvedValue(null);

    const response = await call("missing", true);

    expect(response.status).toBe(404);
  });

  it("returns 403 when the caller does not own the report", async () => {
    const report = makeReport({
      id: "r1",
      userId: "someone_else",
      status: ReportStatus.SUBMITTED,
      issueGroupId: null,
    });
    prismaMock.report.findUnique.mockResolvedValue(report);

    const response = await call("r1", true);

    expect(response.status).toBe(403);
    expect(prismaMock.report.update).not.toHaveBeenCalled();
  });
});
