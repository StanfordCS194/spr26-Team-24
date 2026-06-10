import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Boundaries the route depends on: the eligible-report query and the email
// sender. Mock both so no DB or Brevo network runs.
const {
  findStaleUnresolvedReportsForFollowUp,
  sendReportFollowUpReminderEmail,
} = vi.hoisted(() => ({
  findStaleUnresolvedReportsForFollowUp: vi.fn(),
  sendReportFollowUpReminderEmail: vi.fn(),
}));
vi.mock("@/lib/reports/follow-up-reminders", () => ({
  findStaleUnresolvedReportsForFollowUp,
}));
vi.mock("@/lib/email", () => ({ sendReportFollowUpReminderEmail }));

import { POST } from "./route";

const SECRET = "test-secret";

function post(
  opts: { secret?: string; bearer?: string; query?: string } = {},
): NextRequest {
  const headers: Record<string, string> = {};
  if (opts.secret) headers["x-follow-up-reminder-secret"] = opts.secret;
  if (opts.bearer) headers["authorization"] = `Bearer ${opts.bearer}`;
  return new NextRequest(
    `http://localhost/api/reports/send-follow-up-reminders${opts.query ?? ""}`,
    { method: "POST", headers },
  );
}

function makeCandidate(overrides: Record<string, unknown> = {}) {
  return {
    id: "report_1",
    issueType: "ROAD_DAMAGE",
    status: "CONFIRMED",
    description: "Pothole",
    aiDescription: null,
    address: "University Ave",
    externalTrackingId: null,
    createdAt: new Date("2025-01-01T00:00:00.000Z"),
    updatedAt: new Date("2025-01-01T00:00:00.000Z"),
    user: { email: "u@x.com", name: "U" },
    ...overrides,
  };
}

describe("POST /api/reports/send-follow-up-reminders", () => {
  beforeEach(() => {
    findStaleUnresolvedReportsForFollowUp.mockReset();
    sendReportFollowUpReminderEmail.mockReset();
    vi.stubEnv("FOLLOW_UP_REMINDER_SECRET", SECRET);
    vi.stubEnv("BREVO_API_KEY", "brevo-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns 500 when FOLLOW_UP_REMINDER_SECRET is not configured", async () => {
    // Arrange
    vi.stubEnv("FOLLOW_UP_REMINDER_SECRET", "");

    // Act
    const res = await POST(post({ secret: SECRET }));
    const body = await res.json();

    // Assert
    expect(res.status).toBe(500);
    expect(body.success).toBe(false);
    expect(body.error).toContain("FOLLOW_UP_REMINDER_SECRET is not configured");
    expect(findStaleUnresolvedReportsForFollowUp).not.toHaveBeenCalled();
  });

  it("returns 401 when the secret is missing or wrong", async () => {
    // Act
    const res = await POST(post({ secret: "wrong" }));
    const body = await res.json();

    // Assert
    expect(res.status).toBe(401);
    expect(body).toEqual({ success: false, error: "Not authorized." });
    expect(findStaleUnresolvedReportsForFollowUp).not.toHaveBeenCalled();
  });

  it("authorizes via the bearer token as well as the header secret", async () => {
    // Arrange
    findStaleUnresolvedReportsForFollowUp.mockResolvedValue([]);

    // Act: dryRun defaults to true, so no Brevo key is required.
    const res = await POST(post({ bearer: SECRET }));
    const body = await res.json();

    // Assert
    expect(res.status).toBe(200);
    expect(body.data.dryRun).toBe(true);
  });

  it("dry-runs by default: counts eligible reports as skipped and sends nothing", async () => {
    // Arrange
    findStaleUnresolvedReportsForFollowUp.mockResolvedValue([
      makeCandidate({ id: "report_1" }),
      makeCandidate({ id: "report_2" }),
    ]);

    // Act
    const res = await POST(post({ secret: SECRET }));
    const body = await res.json();

    // Assert
    expect(res.status).toBe(200);
    expect(body.data).toMatchObject({
      staleDays: 14,
      dryRun: true,
      eligibleReports: 2,
      sent: 0,
      skipped: 2,
      failures: [],
    });
    expect(sendReportFollowUpReminderEmail).not.toHaveBeenCalled();
  });

  it("honours a custom positive ?days override", async () => {
    // Arrange
    findStaleUnresolvedReportsForFollowUp.mockResolvedValue([]);

    // Act
    const res = await POST(post({ secret: SECRET, query: "?days=30" }));
    const body = await res.json();

    // Assert
    expect(body.data.staleDays).toBe(30);
    expect(findStaleUnresolvedReportsForFollowUp).toHaveBeenCalledWith({
      staleDays: 30,
    });
  });

  it("falls back to the default stale window for a non-positive ?days", async () => {
    // Arrange
    findStaleUnresolvedReportsForFollowUp.mockResolvedValue([]);

    // Act
    const res = await POST(post({ secret: SECRET, query: "?days=0" }));
    const body = await res.json();

    // Assert
    expect(body.data.staleDays).toBe(14);
  });

  it("returns 500 when dryRun=false but BREVO_API_KEY is unset", async () => {
    // Arrange
    vi.stubEnv("BREVO_API_KEY", "");

    // Act
    const res = await POST(post({ secret: SECRET, query: "?dryRun=false" }));
    const body = await res.json();

    // Assert
    expect(res.status).toBe(500);
    expect(body.error).toContain("BREVO_API_KEY is not configured");
    expect(findStaleUnresolvedReportsForFollowUp).not.toHaveBeenCalled();
  });

  it("sends one reminder per eligible report when dryRun=false", async () => {
    // Arrange
    findStaleUnresolvedReportsForFollowUp.mockResolvedValue([
      makeCandidate({ id: "report_1" }),
      makeCandidate({ id: "report_2" }),
    ]);
    sendReportFollowUpReminderEmail.mockResolvedValue(undefined);

    // Act
    const res = await POST(post({ secret: SECRET, query: "?dryRun=false" }));
    const body = await res.json();

    // Assert
    expect(res.status).toBe(200);
    expect(body.data).toMatchObject({
      dryRun: false,
      eligibleReports: 2,
      sent: 2,
      skipped: 0,
      failures: [],
    });
    expect(sendReportFollowUpReminderEmail).toHaveBeenCalledTimes(2);
  });

  it("skips a candidate with no user and records per-report failures", async () => {
    // Arrange
    findStaleUnresolvedReportsForFollowUp.mockResolvedValue([
      makeCandidate({ id: "no_user", user: null }),
      makeCandidate({ id: "ok" }),
      makeCandidate({ id: "boom" }),
    ]);
    sendReportFollowUpReminderEmail.mockImplementation(
      async (_user: unknown, report: { id: string }) => {
        if (report.id === "boom") throw new Error("brevo 500");
      },
    );

    // Act
    const res = await POST(post({ secret: SECRET, query: "?dryRun=false" }));
    const body = await res.json();

    // Assert
    expect(res.status).toBe(200);
    expect(body.data.sent).toBe(1);
    expect(body.data.skipped).toBe(1);
    expect(body.data.failures).toEqual([
      { reportId: "boom", error: "brevo 500" },
    ]);
  });

  it("returns 500 when the eligible-report lookup throws", async () => {
    // Arrange
    vi.spyOn(console, "error").mockImplementation(() => {});
    findStaleUnresolvedReportsForFollowUp.mockRejectedValue(
      new Error("db down"),
    );

    // Act
    const res = await POST(post({ secret: SECRET }));
    const body = await res.json();

    // Assert
    expect(res.status).toBe(500);
    expect(body).toEqual({
      success: false,
      error: "Failed to look up eligible reports.",
    });
  });
});
