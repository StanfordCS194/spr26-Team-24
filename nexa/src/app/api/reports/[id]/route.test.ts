import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { makeReport } from "@/test/factories/report";
import { prismaMock } from "@/test/prisma-mock";

// DELETE is owner-only: it gates on getSession(), so mock the auth module to
// drive authenticated / anonymous / wrong-owner cases.
vi.mock("@/lib/auth", () => ({ getSession: vi.fn() }));
import { getSession } from "@/lib/auth";

import { DELETE } from "./route";

const mockedGetSession = vi.mocked(getSession);

function deleteRequest(): NextRequest {
  return new NextRequest("http://localhost/api/reports/report_1", {
    method: "DELETE",
  });
}

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("DELETE /api/reports/[id]", () => {
  beforeEach(() => {
    mockedGetSession.mockReset();
    // The handler runs its delete inside prisma.$transaction(async (tx) => ...);
    // make the deep-mocked transaction invoke the callback with the mock client.
    prismaMock.$transaction.mockImplementation(async (arg: unknown) => {
      if (typeof arg === "function") {
        return (arg as (tx: typeof prismaMock) => unknown)(prismaMock);
      }
      return arg;
    });
  });

  it("returns 401 when the caller is not authenticated", async () => {
    // Arrange
    mockedGetSession.mockResolvedValue(null);

    // Act
    const response = await DELETE(deleteRequest(), params("report_1"));
    const body = await response.json();

    // Assert
    expect(response.status).toBe(401);
    expect(body).toEqual({ success: false, error: "Not authenticated." });
    expect(prismaMock.report.findUnique).not.toHaveBeenCalled();
  });

  it("returns 404 when the report does not exist", async () => {
    // Arrange
    mockedGetSession.mockResolvedValue({ userId: "u1", email: "u1@x.com" });
    prismaMock.report.findUnique.mockResolvedValue(null);

    // Act
    const response = await DELETE(deleteRequest(), params("missing"));
    const body = await response.json();

    // Assert
    expect(response.status).toBe(404);
    expect(body).toEqual({ success: false, error: "Report not found." });
    expect(prismaMock.report.delete).not.toHaveBeenCalled();
  });

  it("returns 403 when the caller does not own the report", async () => {
    // Arrange
    mockedGetSession.mockResolvedValue({ userId: "owner", email: "o@x.com" });
    prismaMock.report.findUnique.mockResolvedValue(
      makeReport({
        id: "report_1",
        userId: "someone_else",
        issueGroupId: null,
      }),
    );

    // Act
    const response = await DELETE(deleteRequest(), params("report_1"));
    const body = await response.json();

    // Assert
    expect(response.status).toBe(403);
    expect(body).toEqual({
      success: false,
      error: "You can only delete your own reports.",
    });
    expect(prismaMock.report.delete).not.toHaveBeenCalled();
  });

  it("deletes the report when the caller owns it", async () => {
    // Arrange
    mockedGetSession.mockResolvedValue({ userId: "owner", email: "o@x.com" });
    prismaMock.report.findUnique.mockResolvedValue(
      makeReport({ id: "report_1", userId: "owner", issueGroupId: null }),
    );
    prismaMock.report.delete.mockResolvedValue(makeReport({ id: "report_1" }));

    // Act
    const response = await DELETE(deleteRequest(), params("report_1"));
    const body = await response.json();

    // Assert
    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true, data: { deleted: true } });
    expect(prismaMock.report.delete).toHaveBeenCalledExactlyOnceWith({
      where: { id: "report_1" },
    });
  });

  it("returns 500 when the delete throws", async () => {
    // Arrange
    mockedGetSession.mockResolvedValue({ userId: "owner", email: "o@x.com" });
    prismaMock.report.findUnique.mockResolvedValue(
      makeReport({ id: "report_1", userId: "owner", issueGroupId: null }),
    );
    prismaMock.report.delete.mockRejectedValue(new Error("db down"));

    // Act
    const response = await DELETE(deleteRequest(), params("report_1"));
    const body = await response.json();

    // Assert
    expect(response.status).toBe(500);
    expect(body).toEqual({
      success: false,
      error: "Failed to delete report. Please try again.",
    });
  });
});
