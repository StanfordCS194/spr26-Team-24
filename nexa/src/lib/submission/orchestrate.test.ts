import { describe, expect, it, vi, beforeEach } from "vitest";

import { IntakeMethod, ReportStatus } from "@/generated/prisma/enums";
import { makeReport } from "@/test/factories/report";
import { makeAgency } from "@/test/factories/agency";
import { prismaMock } from "@/test/prisma-mock";

// The orchestrator delegates the actual API call to submitToOpen311; we stub it
// so these tests exercise dispatch + status transitions, not the HTTP client
// (which has its own tests in open311.test.ts).
const submitToOpen311 = vi.fn();
vi.mock("@/lib/submission/open311", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/submission/open311")
  >("@/lib/submission/open311");
  return {
    ...actual,
    submitToOpen311: (...args: unknown[]) => submitToOpen311(...args),
  };
});

// The EMAIL path delegates to submitViaEmail; stub it so these tests exercise
// dispatch + status transitions, not the Resend client (tested in email.test.ts).
const submitViaEmail = vi.fn();
vi.mock("@/lib/submission/email", () => ({
  submitViaEmail: (...args: unknown[]) => submitViaEmail(...args),
}));

// resolveAgencyId hits prisma; stub it so on-demand resolution is deterministic.
const resolveAgencyId = vi.fn();
vi.mock("@/lib/jurisdictions/agency", () => ({
  resolveAgencyId: (...args: unknown[]) => resolveAgencyId(...args),
}));

import { orchestrateSubmission } from "./orchestrate";

beforeEach(() => {
  submitToOpen311.mockReset();
  submitViaEmail.mockReset();
  resolveAgencyId.mockReset();
});

// A confirmed report whose API agency is already attached. The `as never` casts
// satisfy the deep-mock's overloaded signatures without re-stating their types.
function stubReportWithAgency(
  reportOverrides = {},
  agencyOverrides = {},
): { reportId: string } {
  const agency = makeAgency({
    intakeMethod: IntakeMethod.API,
    ...agencyOverrides,
  });
  const report = makeReport({
    status: ReportStatus.CONFIRMED,
    agencyId: agency.id,
    externalTrackingId: null,
    ...reportOverrides,
  });
  prismaMock.report.findUnique.mockResolvedValue({
    ...report,
    agency,
  } as never);
  return { reportId: report.id };
}

describe("orchestrateSubmission — API intake (automated)", () => {
  it("files via Open311 and advances to SUBMITTED with the tracking id", async () => {
    // Arrange
    const { reportId } = stubReportWithAgency({ userId: null });
    prismaMock.report.updateMany.mockResolvedValue({ count: 1 } as never);
    submitToOpen311.mockResolvedValue({
      status: "submitted",
      serviceRequestId: "SR-123",
      token: null,
    });
    prismaMock.report.update.mockResolvedValue(
      makeReport({
        id: reportId,
        status: ReportStatus.SUBMITTED,
        externalTrackingId: "SR-123",
      }) as never,
    );

    // Act
    const result = await orchestrateSubmission(reportId, {});

    // Assert
    expect(result).toEqual({
      status: "submitted",
      reportId,
      externalTrackingId: "SR-123",
    });
    // Claimed CONFIRMED -> SUBMITTING atomically before submitting.
    expect(prismaMock.report.updateMany).toHaveBeenCalledWith({
      where: { id: reportId, status: ReportStatus.CONFIRMED },
      data: { status: ReportStatus.SUBMITTING },
    });
  });

  it("falls back to the async token when no service_request_id is returned", async () => {
    // Arrange
    const { reportId } = stubReportWithAgency({ userId: null });
    prismaMock.report.updateMany.mockResolvedValue({ count: 1 } as never);
    submitToOpen311.mockResolvedValue({
      status: "submitted",
      serviceRequestId: null,
      token: "tok-abc",
    });
    prismaMock.report.update.mockResolvedValue(
      makeReport({
        id: reportId,
        status: ReportStatus.SUBMITTED,
        externalTrackingId: "tok-abc",
      }) as never,
    );

    // Act
    const result = await orchestrateSubmission(reportId, {});

    // Assert
    expect(result).toMatchObject({
      status: "submitted",
      externalTrackingId: "tok-abc",
    });
  });

  it("rolls back to CONFIRMED and reports submit_failed when the agent errors", async () => {
    // Arrange
    const { reportId } = stubReportWithAgency({ userId: null });
    prismaMock.report.updateMany.mockResolvedValue({ count: 1 } as never);
    submitToOpen311.mockResolvedValue({
      status: "error",
      httpStatus: 502,
      message: "Open311 endpoint timed out.",
    });
    prismaMock.report.update.mockResolvedValue(
      makeReport({ id: reportId, status: ReportStatus.CONFIRMED }) as never,
    );

    // Act
    const result = await orchestrateSubmission(reportId, {});

    // Assert
    expect(result).toEqual({
      status: "error",
      code: "submit_failed",
      message: "Open311 endpoint timed out.",
    });
    // Status rolled back so the user can retry.
    expect(prismaMock.report.update).toHaveBeenCalledWith({
      where: { id: reportId },
      data: { status: ReportStatus.CONFIRMED },
    });
  });

  it("reports in_progress when the atomic claim loses the race", async () => {
    // Arrange
    const { reportId } = stubReportWithAgency({ userId: null });
    prismaMock.report.updateMany.mockResolvedValue({ count: 0 } as never);

    // Act
    const result = await orchestrateSubmission(reportId, {});

    // Assert
    expect(result).toMatchObject({ status: "error", code: "in_progress" });
    expect(submitToOpen311).not.toHaveBeenCalled();
  });
});

describe("orchestrateSubmission — non-automated intake (graceful fallback)", () => {
  it.each([IntakeMethod.WEB_FORM, IntakeMethod.PHONE])(
    "returns manual_assist (not an error) for %s intake",
    async (intakeMethod) => {
      // Arrange
      const { reportId } = stubReportWithAgency(
        { userId: null },
        {
          intakeMethod,
          name: "Palo Alto 311",
          intakeUrl: "https://paloalto.gov/311",
          intakeEmail: "311@paloalto.gov",
        },
      );

      // Act
      const result = await orchestrateSubmission(reportId, {});

      // Assert: degrade gracefully, never 400, report stays CONFIRMED.
      expect(result).toEqual({
        status: "manual_assist",
        reportId,
        intakeMethod,
        agencyName: "Palo Alto 311",
        intakeUrl: "https://paloalto.gov/311",
        intakeEmail: "311@paloalto.gov",
        intakePhone: null,
      });
      expect(prismaMock.report.updateMany).not.toHaveBeenCalled();
      expect(submitToOpen311).not.toHaveBeenCalled();
      expect(submitViaEmail).not.toHaveBeenCalled();
    },
  );
});

describe("orchestrateSubmission — EMAIL intake (email agent, #31)", () => {
  function stubEmailAgency(reportOverrides = {}): { reportId: string } {
    return stubReportWithAgency(reportOverrides, {
      intakeMethod: IntakeMethod.EMAIL,
      name: "Palo Alto Public Works",
      intakeUrl: null,
      intakeEmail: "311@paloalto.gov",
    });
  }

  it("claims the report, sends via the email agent, and advances to SUBMITTED", async () => {
    // Arrange
    const { reportId } = stubEmailAgency({ userId: null });
    prismaMock.report.updateMany.mockResolvedValue({ count: 1 } as never);
    submitViaEmail.mockResolvedValue({
      status: "submitted",
      messageId: "msg-789",
    });
    prismaMock.report.update.mockResolvedValue(
      makeReport({
        id: reportId,
        status: ReportStatus.SUBMITTED,
        externalTrackingId: "msg-789",
      }) as never,
    );

    // Act
    const result = await orchestrateSubmission(reportId, {});

    // Assert
    expect(result).toEqual({
      status: "submitted",
      reportId,
      externalTrackingId: "msg-789",
    });
    // Claimed CONFIRMED -> SUBMITTING atomically before sending.
    expect(prismaMock.report.updateMany).toHaveBeenCalledWith({
      where: { id: reportId, status: ReportStatus.CONFIRMED },
      data: { status: ReportStatus.SUBMITTING },
    });
    expect(submitViaEmail).toHaveBeenCalledOnce();
    expect(submitToOpen311).not.toHaveBeenCalled();
  });

  it("falls back to manual_assist (env-gated off) and rolls back to CONFIRMED", async () => {
    // Arrange: the agent is not configured (no RESEND_API_KEY).
    const { reportId } = stubEmailAgency({ userId: null });
    prismaMock.report.updateMany.mockResolvedValue({ count: 1 } as never);
    submitViaEmail.mockResolvedValue({
      status: "not_configured",
      reason: "RESEND_API_KEY is not set; email submission is disabled.",
    });
    prismaMock.report.update.mockResolvedValue(
      makeReport({ id: reportId, status: ReportStatus.CONFIRMED }) as never,
    );

    // Act
    const result = await orchestrateSubmission(reportId, {});

    // Assert: degrade gracefully, never an error; status rolled back.
    expect(result).toEqual({
      status: "manual_assist",
      reportId,
      intakeMethod: IntakeMethod.EMAIL,
      agencyName: "Palo Alto Public Works",
      intakeUrl: null,
      intakeEmail: "311@paloalto.gov",
      intakePhone: null,
    });
    expect(prismaMock.report.update).toHaveBeenCalledWith({
      where: { id: reportId },
      data: { status: ReportStatus.CONFIRMED },
    });
  });

  it("falls back to manual_assist and rolls back when the send errors", async () => {
    // Arrange
    const { reportId } = stubEmailAgency({ userId: null });
    prismaMock.report.updateMany.mockResolvedValue({ count: 1 } as never);
    submitViaEmail.mockResolvedValue({
      status: "error",
      message: "Resend rejected the submission email.",
    });
    prismaMock.report.update.mockResolvedValue(
      makeReport({ id: reportId, status: ReportStatus.CONFIRMED }) as never,
    );

    // Act
    const result = await orchestrateSubmission(reportId, {});

    // Assert
    expect(result).toMatchObject({
      status: "manual_assist",
      intakeMethod: IntakeMethod.EMAIL,
    });
    expect(prismaMock.report.update).toHaveBeenCalledWith({
      where: { id: reportId },
      data: { status: ReportStatus.CONFIRMED },
    });
  });

  it("reports in_progress when the atomic claim loses the race", async () => {
    // Arrange
    const { reportId } = stubEmailAgency({ userId: null });
    prismaMock.report.updateMany.mockResolvedValue({ count: 0 } as never);

    // Act
    const result = await orchestrateSubmission(reportId, {});

    // Assert
    expect(result).toMatchObject({ status: "error", code: "in_progress" });
    expect(submitViaEmail).not.toHaveBeenCalled();
  });
});

describe("orchestrateSubmission — preconditions", () => {
  it("returns not_found for a missing report", async () => {
    // Arrange
    prismaMock.report.findUnique.mockResolvedValue(null as never);

    // Act
    const result = await orchestrateSubmission("missing", {});

    // Assert
    expect(result).toMatchObject({ status: "error", code: "not_found" });
  });

  it("returns forbidden when a different user submits an owned report", async () => {
    // Arrange
    stubReportWithAgency({ id: "r1", userId: "owner" });

    // Act
    const result = await orchestrateSubmission("r1", { userId: "intruder" });

    // Assert
    expect(result).toMatchObject({ status: "error", code: "forbidden" });
  });

  it("returns already_submitted when a tracking id is already present", async () => {
    // Arrange
    stubReportWithAgency({
      id: "r2",
      userId: null,
      externalTrackingId: "SR-9",
    });

    // Act
    const result = await orchestrateSubmission("r2", {});

    // Assert
    expect(result).toMatchObject({
      status: "error",
      code: "already_submitted",
    });
  });

  it("resolves and persists an agency on demand when one isn't set", async () => {
    // Arrange: a report with no agency that resolves to an API agency.
    const report = makeReport({
      id: "r3",
      userId: null,
      agencyId: null,
      status: ReportStatus.CONFIRMED,
      externalTrackingId: null,
    });
    prismaMock.report.findUnique.mockResolvedValue({
      ...report,
      agency: null,
    } as never);
    resolveAgencyId.mockResolvedValue({
      agencyId: "agency_x",
      candidates: ["agency_x"],
    });
    prismaMock.report.update.mockResolvedValue(report as never);
    prismaMock.agency.findUnique.mockResolvedValue(
      makeAgency({ id: "agency_x", intakeMethod: IntakeMethod.API }) as never,
    );
    prismaMock.report.updateMany.mockResolvedValue({ count: 1 } as never);
    submitToOpen311.mockResolvedValue({
      status: "submitted",
      serviceRequestId: "SR-onresolve",
      token: null,
    });
    prismaMock.report.update.mockResolvedValueOnce(report as never);
    prismaMock.report.update.mockResolvedValue(
      makeReport({
        id: "r3",
        status: ReportStatus.SUBMITTED,
        externalTrackingId: "SR-onresolve",
      }) as never,
    );

    // Act
    const result = await orchestrateSubmission("r3", {});

    // Assert
    expect(resolveAgencyId).toHaveBeenCalledOnce();
    expect(prismaMock.report.update).toHaveBeenCalledWith({
      where: { id: "r3" },
      data: { agencyId: "agency_x" },
    });
    expect(result).toMatchObject({ status: "submitted" });
  });

  it("returns no_agency when none can be resolved", async () => {
    // Arrange
    const report = makeReport({
      id: "r4",
      userId: null,
      agencyId: null,
      externalTrackingId: null,
    });
    prismaMock.report.findUnique.mockResolvedValue({
      ...report,
      agency: null,
    } as never);
    resolveAgencyId.mockResolvedValue({ agencyId: null, candidates: [] });

    // Act
    const result = await orchestrateSubmission("r4", {});

    // Assert
    expect(result).toMatchObject({ status: "error", code: "no_agency" });
  });
});
