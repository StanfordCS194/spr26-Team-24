import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { makeReport } from "@/test/factories/report";
import { prismaMock } from "@/test/prisma-mock";

// Resolution is owner-only: it gates on getSession(), so mock the auth module.
vi.mock("@/lib/auth", () => ({ getSession: vi.fn() }));
import { getSession } from "@/lib/auth";

import { POST } from "./route";

const mockedGetSession = vi.mocked(getSession);

function resolutionRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/reports/report_1/resolution", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("POST /api/reports/[id]/resolution", () => {
  beforeEach(() => {
    mockedGetSession.mockReset();
  });

  it("returns 401 when the caller is not authenticated", async () => {
    // Arrange
    mockedGetSession.mockResolvedValue(null);

    // Act
    const response = await POST(
      resolutionRequest({ resolved: true }),
      params("report_1"),
    );
    const body = await response.json();

    // Assert
    expect(response.status).toBe(401);
    expect(body).toEqual({ success: false, error: "Not authenticated." });
    expect(prismaMock.report.findUnique).not.toHaveBeenCalled();
  });

  it("returns 400 when `resolved` is not a boolean", async () => {
    // Arrange
    mockedGetSession.mockResolvedValue({ userId: "owner", email: "o@x.com" });

    // Act
    const response = await POST(
      resolutionRequest({ resolved: "yes" }),
      params("report_1"),
    );
    const body = await response.json();

    // Assert
    expect(response.status).toBe(400);
    expect(body.success).toBe(false);
    // The parser prefixes the failing field path onto the schema message.
    expect(body.error).toBe("resolved: Field `resolved` must be a boolean.");
    expect(prismaMock.report.update).not.toHaveBeenCalled();
  });

  it("returns 404 when the report does not exist", async () => {
    // Arrange
    mockedGetSession.mockResolvedValue({ userId: "owner", email: "o@x.com" });
    prismaMock.report.findUnique.mockResolvedValue(null);

    // Act
    const response = await POST(
      resolutionRequest({ resolved: true }),
      params("missing"),
    );
    const body = await response.json();

    // Assert
    expect(response.status).toBe(404);
    expect(body).toEqual({ success: false, error: "Report not found." });
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
    const response = await POST(
      resolutionRequest({ resolved: true }),
      params("report_1"),
    );
    const body = await response.json();

    // Assert
    expect(response.status).toBe(403);
    expect(body).toEqual({
      success: false,
      error: "You can only update your own reports.",
    });
    expect(prismaMock.report.update).not.toHaveBeenCalled();
  });

  it("marks an ungrouped report resolved and promotes its status to RESOLVED", async () => {
    // Arrange
    mockedGetSession.mockResolvedValue({ userId: "owner", email: "o@x.com" });
    prismaMock.report.findUnique.mockResolvedValue(
      makeReport({
        id: "report_1",
        userId: "owner",
        issueGroupId: null,
        status: "CONFIRMED",
      }),
    );
    // The route returns exactly what `update` resolves to; the real query uses a
    // narrowed `select`, so mirror that shape here.
    prismaMock.report.update.mockResolvedValue({
      id: "report_1",
      userResolved: true,
      status: "RESOLVED",
    } as Awaited<ReturnType<typeof prismaMock.report.update>>);

    // Act
    const response = await POST(
      resolutionRequest({ resolved: true }),
      params("report_1"),
    );
    const body = await response.json();

    // Assert
    expect(response.status).toBe(200);
    expect(body).toEqual({
      success: true,
      data: { id: "report_1", userResolved: true, status: "RESOLVED" },
    });

    const updateArgs = prismaMock.report.update.mock.calls[0][0];
    expect(updateArgs.where).toEqual({ id: "report_1" });
    expect(updateArgs.data).toMatchObject({
      userResolved: true,
      status: "RESOLVED",
    });
    expect(updateArgs.data?.userResolvedAt).toBeInstanceOf(Date);
  });

  it("keeps the existing status when un-resolving (resolved=false)", async () => {
    // Arrange
    mockedGetSession.mockResolvedValue({ userId: "owner", email: "o@x.com" });
    prismaMock.report.findUnique.mockResolvedValue(
      makeReport({
        id: "report_1",
        userId: "owner",
        issueGroupId: null,
        status: "CONFIRMED",
      }),
    );
    prismaMock.report.update.mockResolvedValue({
      id: "report_1",
      userResolved: false,
      status: "CONFIRMED",
    } as Awaited<ReturnType<typeof prismaMock.report.update>>);

    // Act
    const response = await POST(
      resolutionRequest({ resolved: false }),
      params("report_1"),
    );
    const body = await response.json();

    // Assert
    expect(response.status).toBe(200);
    const updateArgs = prismaMock.report.update.mock.calls[0][0];
    // resolved=false leaves status untouched (stays CONFIRMED).
    expect(updateArgs.data).toMatchObject({
      userResolved: false,
      status: "CONFIRMED",
    });
  });

  it("returns 500 when the update throws", async () => {
    // Arrange
    mockedGetSession.mockResolvedValue({ userId: "owner", email: "o@x.com" });
    prismaMock.report.findUnique.mockResolvedValue(
      makeReport({ id: "report_1", userId: "owner", issueGroupId: null }),
    );
    prismaMock.report.update.mockRejectedValue(new Error("db down"));

    // Act
    const response = await POST(
      resolutionRequest({ resolved: true }),
      params("report_1"),
    );
    const body = await response.json();

    // Assert
    expect(response.status).toBe(500);
    expect(body).toEqual({
      success: false,
      error: "Failed to update resolution. Please try again.",
    });
  });
});
