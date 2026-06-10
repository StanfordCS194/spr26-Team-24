import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { comparisonResult } from "@/test/fixtures/classification";

// The route fans out to paid LLM providers via `classifyWithConsensus`; mock it
// so the route's own logic (validation, LocationContext assembly, error mapping)
// runs with zero network/LLM. `vi.hoisted` lets the hoisted `vi.mock` factory
// reference the spy without a TDZ error.
const { classifyWithConsensus } = vi.hoisted(() => ({
  classifyWithConsensus: vi.fn(),
}));
vi.mock("@/lib/classify/consensus", () => ({ classifyWithConsensus }));

import { POST } from "./route";
import { __resetRateLimitStore } from "@/lib/rate-limit";

function post(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/reports/classify", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": "10.0.0.1",
    },
    body: JSON.stringify(body),
  });
}

const extendedResult = {
  ...comparisonResult,
  observation: null,
  preprocess: null,
  locationUsed: null,
};

describe("POST /api/reports/classify", () => {
  beforeEach(() => {
    __resetRateLimitStore();
    classifyWithConsensus.mockReset();
    classifyWithConsensus.mockResolvedValue(extendedResult);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 400 when neither description nor imageBase64 is provided", async () => {
    // Act
    const res = await POST(post({}));
    const body = await res.json();

    // Assert
    expect(res.status).toBe(400);
    expect(body).toEqual({
      success: false,
      error: "Provide a description or image.",
    });
    expect(classifyWithConsensus).not.toHaveBeenCalled();
  });

  it("classifies a description-only request and returns the consensus result", async () => {
    // Act
    const res = await POST(post({ description: "Pothole on Main St" }));
    const body = await res.json();

    // Assert
    expect(res.status).toBe(200);
    expect(body).toEqual({ success: true, data: extendedResult });
    expect(classifyWithConsensus).toHaveBeenCalledWith(
      "Pothole on Main St",
      null,
      { twoStage: true, location: null },
    );
  });

  it("proceeds with an image-only request (no description)", async () => {
    // Act
    const res = await POST(post({ imageBase64: "data:image/png;base64,AAAA" }));

    // Assert: empty-string description, image forwarded, no location.
    expect(res.status).toBe(200);
    expect(classifyWithConsensus).toHaveBeenCalledWith(
      "",
      "data:image/png;base64,AAAA",
      { twoStage: true, location: null },
    );
  });

  it("builds a LocationContext from lat/lon/address/jurisdiction", async () => {
    // Act
    await POST(
      post({
        description: "Streetlight out",
        latitude: 37.44,
        longitude: -122.14,
        address: "123 Main St",
        jurisdiction: "Palo Alto",
      }),
    );

    // Assert
    expect(classifyWithConsensus).toHaveBeenCalledWith(
      "Streetlight out",
      null,
      {
        twoStage: true,
        location: {
          latitude: 37.44,
          longitude: -122.14,
          address: "123 Main St",
          jurisdiction: "Palo Alto",
        },
      },
    );
  });

  it("builds a LocationContext when only an address is supplied (no coords)", async () => {
    // Act
    await POST(post({ description: "x", address: "456 Elm St" }));

    // Assert: missing coords become null, address present -> location built.
    expect(classifyWithConsensus).toHaveBeenCalledWith("x", null, {
      twoStage: true,
      location: {
        latitude: null,
        longitude: null,
        address: "456 Elm St",
        jurisdiction: null,
      },
    });
  });

  it("returns 400 when the body is not valid JSON", async () => {
    // Arrange: malformed JSON body exercises the RequestParseError path.
    const req = new NextRequest("http://localhost/api/reports/classify", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "10.0.0.2",
      },
      body: "{ not json",
    });

    // Act
    const res = await POST(req);

    // Assert
    expect(res.status).toBe(400);
    expect(classifyWithConsensus).not.toHaveBeenCalled();
  });

  it("returns 400 when latitude is out of WGS84 range (schema bound)", async () => {
    // Act
    const res = await POST(post({ description: "x", latitude: 200 }));
    const body = await res.json();

    // Assert
    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
    expect(classifyWithConsensus).not.toHaveBeenCalled();
  });

  it("returns 500 when consensus classification throws", async () => {
    // Arrange
    vi.spyOn(console, "error").mockImplementation(() => {});
    classifyWithConsensus.mockRejectedValue(new Error("provider down"));

    // Act
    const res = await POST(post({ description: "x" }));
    const body = await res.json();

    // Assert
    expect(res.status).toBe(500);
    expect(body).toEqual({
      success: false,
      error: "Classification failed. Please try again.",
    });
  });
});
