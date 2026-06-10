import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { makeAgency } from "@/test/factories/agency";
import { makeReport } from "@/test/factories/report";
import { prismaMock } from "@/test/prisma-mock";
import { ReportStatus } from "@/generated/prisma/enums";

// Mock the Open311 module so we control poll results without any network. We
// re-export the real STATUS_RANK / parseOpen311Config so the route's lifecycle
// logic still runs; only fetchOpen311Status is stubbed. `vi.hoisted` lets the
// hoisted `vi.mock` factory reference the spy without a TDZ error.
const { fetchOpen311Status } = vi.hoisted(() => ({
  fetchOpen311Status: vi.fn(),
}));
vi.mock("@/lib/submission/open311", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/submission/open311")>();
  return { ...actual, fetchOpen311Status };
});

import { GET } from "./route";

const SECRET = "test-cron-secret";

function authedRequest(): NextRequest {
  return new NextRequest("http://localhost/api/cron/poll-status", {
    headers: { authorization: `Bearer ${SECRET}` },
  });
}

function trackedReport() {
  return makeReport({
    status: ReportStatus.SUBMITTED,
    externalTrackingId: "sr-123",
    agency: makeAgency(),
  } as Parameters<typeof makeReport>[0]);
}

describe("GET /api/cron/poll-status", () => {
  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", SECRET);
    fetchOpen311Status.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("returns 503 when CRON_SECRET is unset (fail closed)", async () => {
    // Arrange
    vi.stubEnv("CRON_SECRET", "");

    // Act
    const response = await GET(authedRequest());

    // Assert
    expect(response.status).toBe(503);
    expect(prismaMock.report.findMany).not.toHaveBeenCalled();
  });

  it("returns 401 when the bearer token is wrong", async () => {
    // Act
    const response = await GET(
      new NextRequest("http://localhost/api/cron/poll-status", {
        headers: { authorization: "Bearer nope" },
      }),
    );

    // Assert
    expect(response.status).toBe(401);
  });

  it("advances a report and returns a 200 summary on success", async () => {
    // Arrange
    prismaMock.report.findMany.mockResolvedValue([trackedReport()]);
    prismaMock.report.update.mockResolvedValue(makeReport());
    fetchOpen311Status.mockResolvedValue({
      status: "ok",
      open311Status: "closed",
      reportStatus: ReportStatus.RESOLVED,
      statusNotes: null,
    });

    // Act
    const response = await GET(authedRequest());
    const body = await response.json();

    // Assert
    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      checked: 1,
      updated: 1,
      errorCount: 0,
      ok: true,
      failures: [],
    });
  });

  it("logs a structured per-report failure with the alert prefix", async () => {
    // Arrange
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    prismaMock.report.findMany.mockResolvedValue([trackedReport()]);
    fetchOpen311Status.mockResolvedValue({
      status: "error",
      httpStatus: 500,
      message: "Open311 endpoint returned HTTP 500.",
    });

    // Act
    const response = await GET(authedRequest());
    const body = await response.json();

    // Assert: a single failure -> 100% error rate -> 503, with a structured
    // failure record carrying the report + service request id and reason.
    expect(response.status).toBe(503);
    expect(body.ok).toBe(false);
    expect(body.failures).toHaveLength(1);
    expect(body.failures[0]).toMatchObject({
      serviceRequestId: "sr-123",
      httpStatus: 500,
      reason: "Open311 endpoint returned HTTP 500.",
    });
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("[poll-status][ALERT]"),
      expect.objectContaining({ serviceRequestId: "sr-123" }),
    );
  });

  it("returns 200 when the failure rate stays below the threshold", async () => {
    // Arrange: 1 failure out of 3 (33%) < 50% threshold.
    vi.spyOn(console, "error").mockImplementation(() => {});
    prismaMock.report.findMany.mockResolvedValue([
      trackedReport(),
      trackedReport(),
      trackedReport(),
    ]);
    prismaMock.report.update.mockResolvedValue(makeReport());
    fetchOpen311Status
      .mockResolvedValueOnce({
        status: "ok",
        open311Status: "closed",
        reportStatus: ReportStatus.RESOLVED,
        statusNotes: null,
      })
      .mockResolvedValueOnce({
        status: "ok",
        open311Status: "closed",
        reportStatus: ReportStatus.RESOLVED,
        statusNotes: null,
      })
      .mockResolvedValueOnce({
        status: "error",
        httpStatus: 503,
        message: "unavailable",
      });

    // Act
    const response = await GET(authedRequest());
    const body = await response.json();

    // Assert
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ checked: 3, errorCount: 1, ok: true });
  });

  it("returns 500 with the alert prefix when the DB query throws", async () => {
    // Arrange
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    prismaMock.report.findMany.mockRejectedValue(new Error("db down"));

    // Act
    const response = await GET(authedRequest());

    // Assert
    expect(response.status).toBe(500);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("[poll-status][ALERT]"),
      expect.any(Error),
    );
  });
});
