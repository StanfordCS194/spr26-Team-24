import { NextRequest } from "next/server";
import { describe, expect, it, vi, beforeEach } from "vitest";

import { IntakeMethod } from "@/generated/prisma/enums";

// The route is a thin translator over the orchestrator; mock the orchestrator
// to assert the HTTP mapping per result kind (the orchestrator has its own
// tests). Mock the session so we can exercise owner authorization wiring.
const orchestrateSubmission = vi.fn();
vi.mock("@/lib/submission/orchestrate", () => ({
  orchestrateSubmission: (...args: unknown[]) => orchestrateSubmission(...args),
}));

const getSession = vi.fn();
vi.mock("@/lib/auth", () => ({
  getSession: () => getSession(),
}));

import { POST } from "./route";

function call(id = "report_1") {
  const request = new NextRequest(`http://localhost/api/reports/${id}/submit`, {
    method: "POST",
  });
  return POST(request, { params: Promise.resolve({ id }) });
}

beforeEach(() => {
  orchestrateSubmission.mockReset();
  getSession.mockReset();
  getSession.mockResolvedValue({ userId: "user_1", email: "u@x.com" });
});

describe("POST /api/reports/[id]/submit", () => {
  it("passes the session user id to the orchestrator", async () => {
    // Arrange
    orchestrateSubmission.mockResolvedValue({
      status: "submitted",
      reportId: "report_1",
      externalTrackingId: "SR-1",
    });

    // Act
    await call("report_1");

    // Assert
    expect(orchestrateSubmission).toHaveBeenCalledWith("report_1", {
      userId: "user_1",
    });
  });

  it("returns 200 with the tracking id for an automated submission", async () => {
    // Arrange
    orchestrateSubmission.mockResolvedValue({
      status: "submitted",
      reportId: "report_1",
      externalTrackingId: "SR-1",
    });

    // Act
    const res = await call();
    const body = await res.json();

    // Assert
    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      success: true,
      data: {
        submitted: true,
        status: "SUBMITTED",
        externalTrackingId: "SR-1",
      },
    });
  });

  it("returns 200 (not 400) with manualAssist for non-API intake", async () => {
    // Arrange
    orchestrateSubmission.mockResolvedValue({
      status: "manual_assist",
      reportId: "report_1",
      intakeMethod: IntakeMethod.WEB_FORM,
      agencyName: "Palo Alto 311",
      intakeUrl: "https://paloalto.gov/311",
      intakeEmail: null,
    });

    // Act
    const res = await call();
    const body = await res.json();

    // Assert: graceful degradation, never a 4xx.
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.submitted).toBe(false);
    expect(body.data.manualAssist).toMatchObject({
      intakeMethod: IntakeMethod.WEB_FORM,
      agencyName: "Palo Alto 311",
      intakeUrl: "https://paloalto.gov/311",
    });
  });

  it.each([
    ["not_found", 404],
    ["forbidden", 403],
    ["already_submitted", 409],
    ["in_progress", 409],
    ["no_agency", 400],
    ["submit_failed", 502],
  ] as const)("maps the %s error code to HTTP %i", async (code, httpStatus) => {
    // Arrange
    orchestrateSubmission.mockResolvedValue({
      status: "error",
      code,
      message: "boom",
    });

    // Act
    const res = await call();
    const body = await res.json();

    // Assert
    expect(res.status).toBe(httpStatus);
    expect(body.success).toBe(false);
    expect(body.code).toBe(code);
  });

  it("prefixes the agent reason for submit_failed", async () => {
    // Arrange
    orchestrateSubmission.mockResolvedValue({
      status: "error",
      code: "submit_failed",
      message: "Open311 endpoint timed out.",
    });

    // Act
    const res = await call();
    const body = await res.json();

    // Assert
    expect(body.error).toBe("Submission failed: Open311 endpoint timed out.");
  });

  it("returns 500 when the orchestrator throws unexpectedly", async () => {
    // Arrange
    orchestrateSubmission.mockRejectedValue(new Error("kaboom"));

    // Act
    const res = await call();

    // Assert
    expect(res.status).toBe(500);
  });
});
