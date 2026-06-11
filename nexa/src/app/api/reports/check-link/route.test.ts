import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The detection service is the unit under test elsewhere; here we mock it so the
// route test exercises only the route's posture (rate limit, parse, envelope).
const { checkSubmittableLink } = vi.hoisted(() => ({
  checkSubmittableLink: vi.fn(),
}));

vi.mock("@/lib/submission/link-check", () => ({ checkSubmittableLink }));

import { POST } from "./route";
import { __resetRateLimitStore } from "@/lib/rate-limit";

function post(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/reports/check-link", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": "10.2.0.1",
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/reports/check-link", () => {
  beforeEach(() => {
    __resetRateLimitStore();
    checkSubmittableLink.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the detection verdict for a valid URL", async () => {
    // Arrange
    checkSubmittableLink.mockResolvedValue({
      status: "form_found",
      confidence: "high",
      signals: ["post_form"],
    });

    // Act
    const res = await POST(post({ url: "https://city.gov/report" }));
    const body = await res.json();

    // Assert
    expect(res.status).toBe(200);
    expect(body).toEqual({
      success: true,
      data: {
        status: "form_found",
        confidence: "high",
        signals: ["post_form"],
      },
    });
    expect(checkSubmittableLink).toHaveBeenCalledWith(
      "https://city.gov/report",
    );
  });

  it("returns 400 for a malformed URL without invoking the checker", async () => {
    // Act
    const res = await POST(post({ url: "not a url" }));
    const body = await res.json();

    // Assert
    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
    expect(checkSubmittableLink).not.toHaveBeenCalled();
  });

  it("returns 400 when url is missing", async () => {
    const res = await POST(post({}));
    expect(res.status).toBe(400);
    expect(checkSubmittableLink).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-JSON body", async () => {
    const req = new NextRequest("http://localhost/api/reports/check-link", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "10.2.0.9",
      },
      body: "{not json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("rate-limits abusive callers with a 429 (matches sibling routes)", async () => {
    // Arrange: drive the shared per-IP limiter past its window cap.
    checkSubmittableLink.mockResolvedValue({ status: "no_form", reason: "x" });
    const max = 20; // default RATE_LIMIT_MAX
    let last: Response | undefined;
    for (let i = 0; i < max + 1; i++) {
      last = await POST(post({ url: "https://city.gov/report" }));
    }

    // Assert
    expect(last?.status).toBe(429);
    expect(last?.headers.get("Retry-After")).toBeTruthy();
  });

  it("returns 500 when the checker itself rejects (it normally never throws)", async () => {
    // Arrange
    vi.spyOn(console, "error").mockImplementation(() => {});
    checkSubmittableLink.mockRejectedValue(new Error("unexpected"));

    // Act
    const res = await POST(post({ url: "https://city.gov/report" }));
    const body = await res.json();

    // Assert
    expect(res.status).toBe(500);
    expect(body).toEqual({
      success: false,
      error: "Failed to check the link.",
    });
  });
});
