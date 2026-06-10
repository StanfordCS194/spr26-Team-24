import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { IssueType } from "@/generated/prisma/enums";

// The route delegates routing to resolveAgencyCandidates; mock that boundary so
// no polygon registry or DB runs and we can drive ambiguous/single/empty.
const { resolveAgencyCandidates } = vi.hoisted(() => ({
  resolveAgencyCandidates: vi.fn(),
}));
vi.mock("@/lib/jurisdictions/agency", () => ({ resolveAgencyCandidates }));

import { POST } from "./route";

function post(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/reports/agency-candidates", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const VALID_BODY = {
  issueType: IssueType.ROAD_DAMAGE,
  latitude: 37.44,
  longitude: -122.14,
};

describe("POST /api/reports/agency-candidates", () => {
  beforeEach(() => {
    resolveAgencyCandidates.mockReset();
  });

  it("returns the ambiguous multi-candidate resolution with a disambiguation question", async () => {
    // Arrange
    const resolution = {
      agencyId: null,
      candidates: [
        {
          id: "agency_web",
          name: "Menlo Park Web Desk",
          jurisdiction: "city-menlo-park",
          intakeMethod: "WEB_FORM",
        },
        {
          id: "agency_api",
          name: "Menlo Park Open311",
          jurisdiction: "city-menlo-park",
          intakeMethod: "API",
        },
      ],
      disambiguation:
        "More than one office handles this here. Which should we file your report with?",
    };
    resolveAgencyCandidates.mockResolvedValue(resolution);

    // Act
    const res = await POST(post(VALID_BODY));
    const body = await res.json();

    // Assert
    expect(res.status).toBe(200);
    expect(body).toEqual({ success: true, data: resolution });
    expect(resolveAgencyCandidates).toHaveBeenCalledWith({
      latitude: 37.44,
      longitude: -122.14,
      issueType: IssueType.ROAD_DAMAGE,
    });
  });

  it("returns the single confident match with no disambiguation", async () => {
    // Arrange
    const resolution = {
      agencyId: "agency_1",
      candidates: [
        {
          id: "agency_1",
          name: "Palo Alto 311",
          jurisdiction: "city-palo-alto",
          intakeMethod: "API",
        },
      ],
      disambiguation: null,
    };
    resolveAgencyCandidates.mockResolvedValue(resolution);

    // Act
    const res = await POST(post(VALID_BODY));
    const body = await res.json();

    // Assert
    expect(res.status).toBe(200);
    expect(body.data.agencyId).toBe("agency_1");
    expect(body.data.disambiguation).toBeNull();
    expect(body.data.candidates).toHaveLength(1);
  });

  it("returns the empty resolution when no agency covers the location", async () => {
    // Arrange
    resolveAgencyCandidates.mockResolvedValue({
      agencyId: null,
      candidates: [],
      disambiguation: null,
    });

    // Act
    const res = await POST(post(VALID_BODY));
    const body = await res.json();

    // Assert
    expect(res.status).toBe(200);
    expect(body).toEqual({
      success: true,
      data: { agencyId: null, candidates: [], disambiguation: null },
    });
  });

  it("passes issueType through as null when omitted from the body", async () => {
    // Arrange
    resolveAgencyCandidates.mockResolvedValue({
      agencyId: null,
      candidates: [],
      disambiguation: null,
    });

    // Act
    await POST(post({ latitude: 37.44, longitude: -122.14 }));

    // Assert
    expect(resolveAgencyCandidates).toHaveBeenCalledWith({
      latitude: 37.44,
      longitude: -122.14,
      issueType: null,
    });
  });

  it("returns 400 for an out-of-range coordinate and never resolves", async () => {
    // Act
    const res = await POST(
      post({ issueType: IssueType.ROAD_DAMAGE, latitude: 200, longitude: 0 }),
    );
    const body = await res.json();

    // Assert
    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
    expect(resolveAgencyCandidates).not.toHaveBeenCalled();
  });

  it("returns 400 for an unknown issueType enum value", async () => {
    // Act
    const res = await POST(
      post({
        issueType: "NOT_A_REAL_TYPE",
        latitude: 37.44,
        longitude: -122.14,
      }),
    );
    const body = await res.json();

    // Assert
    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
    expect(resolveAgencyCandidates).not.toHaveBeenCalled();
  });

  it("returns 500 when the resolver throws", async () => {
    // Arrange
    vi.spyOn(console, "error").mockImplementation(() => {});
    resolveAgencyCandidates.mockRejectedValue(new Error("registry boom"));

    // Act
    const res = await POST(post(VALID_BODY));
    const body = await res.json();

    // Assert
    expect(res.status).toBe(500);
    expect(body).toEqual({
      success: false,
      error: "Failed to resolve agency candidates.",
    });
  });
});
