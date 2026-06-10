import { afterEach, describe, expect, it, vi } from "vitest";

import { IssueType } from "@/generated/prisma/enums";

import {
  composeSubmissionEmail,
  submitViaEmail,
  type EmailSubmittableReport,
} from "./email";

// A report with every field present; tests override only what they exercise.
function makeEmailReport(
  overrides: Partial<EmailSubmittableReport> = {},
): EmailSubmittableReport {
  return {
    id: "report_1",
    issueType: IssueType.ROAD_DAMAGE,
    description: "Large pothole on University Ave",
    aiDescription: "AI: a deep pothole",
    latitude: 37.4419,
    longitude: -122.143,
    address: "University Ave, Palo Alto, CA",
    imageUrl: "https://cdn.example.com/photos/abc123.png",
    ...overrides,
  };
}

// The minimal client shape submitViaEmail accepts. We pass a `vi.fn()` for
// `send` and cast, since the real overloaded signature is irrelevant to these
// dispatch tests.
type FakeSend = ReturnType<typeof vi.fn>;
function fakeResend(
  send: FakeSend,
): Parameters<typeof submitViaEmail>[1]["resendClient"] {
  return { emails: { send } } as unknown as Parameters<
    typeof submitViaEmail
  >[1]["resendClient"];
}

// The first payload passed to a fake `send`. `vi.fn()` has no call signature, so
// its `mock.calls` tuple is typed empty — read through `unknown` to inspect it.
function firstSendPayload(send: FakeSend): unknown {
  return (send.mock.calls as unknown as unknown[][])[0][0];
}

// A fetch stub for the photo download that returns a small PNG-ish payload.
function fakePhotoFetch(): typeof fetch {
  return vi.fn(async () => ({
    ok: true,
    arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer,
  })) as unknown as typeof fetch;
}

afterEach(() => {
  delete process.env.RESEND_API_KEY;
  delete process.env.SUBMISSION_FROM_EMAIL;
  vi.restoreAllMocks();
});

describe("composeSubmissionEmail", () => {
  it("includes issue type, location, coordinates, and description", () => {
    // Arrange / Act
    const email = composeSubmissionEmail(makeEmailReport(), {
      agencyName: "Palo Alto Public Works",
    });

    // Assert
    expect(email.subject).toContain("Road Damage");
    expect(email.text).toContain("Issue type: Road Damage");
    expect(email.text).toContain("University Ave, Palo Alto, CA");
    expect(email.text).toContain("37.4419, -122.143");
    expect(email.text).toContain("Large pothole on University Ave");
    expect(email.text).toContain("Palo Alto Public Works");
    expect(email.text).toContain("A photo of the issue is attached");
    expect(email.html).toContain("<strong>Issue type:</strong> Road Damage");
  });

  it("falls back to the AI description and notes a missing photo", () => {
    // Arrange / Act
    const email = composeSubmissionEmail(
      makeEmailReport({ description: null, imageUrl: null }),
      { agencyName: "City 311" },
    );

    // Assert
    expect(email.text).toContain("AI: a deep pothole");
    expect(email.text).toContain("No photo was provided");
  });

  it("escapes HTML in user-supplied content", () => {
    // Arrange / Act
    const email = composeSubmissionEmail(
      makeEmailReport({ description: "<script>alert(1)</script>" }),
      { agencyName: "City 311" },
    );

    // Assert: the raw tag must not survive into the HTML body.
    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("&lt;script&gt;");
  });
});

describe("submitViaEmail — env gating (no-op without config)", () => {
  it("returns not_configured when RESEND_API_KEY is unset", async () => {
    // Arrange: no key in the test env, and no injected client.
    process.env.SUBMISSION_FROM_EMAIL = "reports@nexa.app";

    // Act
    const result = await submitViaEmail(makeEmailReport(), {
      agencyName: "City 311",
      intakeEmail: "311@city.gov",
    });

    // Assert
    expect(result.status).toBe("not_configured");
  });

  it("returns not_configured when SUBMISSION_FROM_EMAIL is unset", async () => {
    // Arrange: a client is available but the sender address is not configured.
    const send = vi.fn();

    // Act
    const result = await submitViaEmail(makeEmailReport(), {
      agencyName: "City 311",
      intakeEmail: "311@city.gov",
      resendClient: fakeResend(send),
    });

    // Assert: env-gated off; no email attempted.
    expect(result.status).toBe("not_configured");
    expect(send).not.toHaveBeenCalled();
  });

  it("returns not_configured when the agency has no intake email", async () => {
    // Arrange
    process.env.SUBMISSION_FROM_EMAIL = "reports@nexa.app";
    const send = vi.fn();

    // Act
    const result = await submitViaEmail(makeEmailReport(), {
      agencyName: "City 311",
      intakeEmail: null,
      resendClient: fakeResend(send),
    });

    // Assert
    expect(result.status).toBe("not_configured");
    expect(send).not.toHaveBeenCalled();
  });
});

describe("submitViaEmail — sending", () => {
  it("sends a composed email with the photo attached and returns the message id", async () => {
    // Arrange
    process.env.SUBMISSION_FROM_EMAIL = "reports@nexa.app";
    const send = vi.fn(async () => ({ data: { id: "msg-123" }, error: null }));

    // Act
    const result = await submitViaEmail(makeEmailReport(), {
      agencyName: "Palo Alto Public Works",
      intakeEmail: "311@paloalto.gov",
      resendClient: fakeResend(send),
      fetchImpl: fakePhotoFetch(),
    });

    // Assert
    expect(result).toEqual({ status: "submitted", messageId: "msg-123" });
    const payload = firstSendPayload(send) as {
      from: string;
      to: string;
      subject: string;
      attachments?: { filename: string }[];
    };
    expect(payload.from).toBe("reports@nexa.app");
    expect(payload.to).toBe("311@paloalto.gov");
    expect(payload.subject).toContain("Road Damage");
    expect(payload.attachments).toHaveLength(1);
    expect(payload.attachments?.[0].filename).toBe("abc123.png");
  });

  it("still sends (no attachment) when the photo download fails", async () => {
    // Arrange
    process.env.SUBMISSION_FROM_EMAIL = "reports@nexa.app";
    const send = vi.fn(async () => ({ data: { id: "msg-456" }, error: null }));
    const failingFetch = vi.fn(async () => ({
      ok: false,
      arrayBuffer: async () => new ArrayBuffer(0),
    })) as unknown as typeof fetch;

    // Act
    const result = await submitViaEmail(makeEmailReport(), {
      agencyName: "City 311",
      intakeEmail: "311@city.gov",
      resendClient: fakeResend(send),
      fetchImpl: failingFetch,
    });

    // Assert: a missing photo never blocks the submission.
    expect(result).toEqual({ status: "submitted", messageId: "msg-456" });
    const payload = firstSendPayload(send) as { attachments?: unknown };
    expect(payload.attachments).toBeUndefined();
  });

  it("returns an error when Resend rejects the message", async () => {
    // Arrange
    process.env.SUBMISSION_FROM_EMAIL = "reports@nexa.app";
    const send = vi.fn(async () => ({
      data: null,
      error: { name: "validation_error", message: "Invalid sender" },
    }));

    // Act
    const result = await submitViaEmail(makeEmailReport({ imageUrl: null }), {
      agencyName: "City 311",
      intakeEmail: "311@city.gov",
      resendClient: fakeResend(send),
    });

    // Assert
    expect(result).toEqual({ status: "error", message: "Invalid sender" });
  });

  it("returns an error when the transport throws", async () => {
    // Arrange
    process.env.SUBMISSION_FROM_EMAIL = "reports@nexa.app";
    const send = vi.fn(async () => {
      throw new Error("network down");
    });

    // Act
    const result = await submitViaEmail(makeEmailReport({ imageUrl: null }), {
      agencyName: "City 311",
      intakeEmail: "311@city.gov",
      resendClient: fakeResend(send),
    });

    // Assert
    expect(result).toEqual({ status: "error", message: "network down" });
  });
});
