import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { IssueType } from "@/generated/prisma/enums";

// External boundaries the route depends on, all mocked so no real Nominatim /
// OpenAI / polygon-data network or compute runs:
//   - fetchWithTimeout: Nominatim reverse (coords->city) and search (address->coords)
//   - resolveJurisdiction: the curated polygon registry
//   - getOpenAI().responses.create: the LLM fallback
// `vi.hoisted` lets the hoisted `vi.mock` factories reference the spies.
const { fetchWithTimeout, resolveJurisdiction, responsesCreate } = vi.hoisted(
  () => ({
    fetchWithTimeout: vi.fn(),
    resolveJurisdiction: vi.fn(),
    responsesCreate: vi.fn(),
  }),
);

vi.mock("@/lib/http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/http")>();
  return { ...actual, fetchWithTimeout };
});

vi.mock("@/lib/jurisdictions/resolve", () => ({ resolveJurisdiction }));

vi.mock("@/lib/openai", () => ({
  getOpenAI: () => ({ responses: { create: responsesCreate } }),
}));

import { POST } from "./route";
import { __resetRateLimitStore } from "@/lib/rate-limit";

function post(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/reports/form-link", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": "10.1.0.1",
    },
    body: JSON.stringify(body),
  });
}

/** Build a Nominatim reverse-lookup Response (object with `.address`). */
function reverseResponse(city: string | null, state: string | null): Response {
  const address: Record<string, string> = {};
  if (city) address.city = city;
  if (state) address.state = state;
  return new Response(JSON.stringify({ address }), { status: 200 });
}

/** An LLM Responses payload carrying `output_text` with the JSON verdict. */
function llmResponse(json: unknown) {
  return { output_text: JSON.stringify(json), output: [] };
}

describe("POST /api/reports/form-link", () => {
  beforeEach(() => {
    __resetRateLimitStore();
    fetchWithTimeout.mockReset();
    resolveJurisdiction.mockReset();
    responsesCreate.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 400 when issueType is missing/invalid", async () => {
    // Act
    const res = await POST(post({ address: "123 Main St" }));
    const body = await res.json();

    // Assert
    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
    expect(fetchWithTimeout).not.toHaveBeenCalled();
  });

  it("returns a verified portal when a polygon match has one (found)", async () => {
    // Arrange: coords resolve, polygon match carries a verified portal.
    fetchWithTimeout.mockResolvedValue(
      reverseResponse("Palo Alto", "California"),
    );
    resolveJurisdiction.mockReturnValue({
      jurisdiction: { displayName: "Palo Alto" },
      portal: {
        url: "https://www.paloalto.gov/311",
        reason: "Palo Alto 311 portal.",
        confidence: "high",
      },
    });

    // Act
    const res = await POST(
      post({
        issueType: IssueType.ROAD_DAMAGE,
        latitude: 37.44,
        longitude: -122.14,
      }),
    );
    const body = await res.json();

    // Assert: deterministic portal wins; the LLM is never consulted.
    expect(res.status).toBe(200);
    expect(body.data).toEqual({
      status: "found",
      cityName: "Palo Alto",
      formUrl: "https://www.paloalto.gov/311",
      reason: "Palo Alto 311 portal.",
      confidence: "high",
    });
    expect(responsesCreate).not.toHaveBeenCalled();
  });

  it("falls back to the LLM and validates a .gov URL via isOfficialCityGovUrl (found)", async () => {
    // Arrange: city resolved from coords, no polygon match -> LLM fallback.
    fetchWithTimeout.mockResolvedValue(
      reverseResponse("Palo Alto", "California"),
    );
    resolveJurisdiction.mockReturnValue(null);
    responsesCreate.mockResolvedValue(
      llmResponse({
        status: "found",
        formUrl: "https://www.paloalto.gov/Report-an-Issue",
        reason: "City 311 page.",
        confidence: "high",
      }),
    );

    // Act
    const res = await POST(
      post({
        issueType: IssueType.ROAD_DAMAGE,
        latitude: 37.44,
        longitude: -122.14,
      }),
    );
    const body = await res.json();

    // Assert
    expect(res.status).toBe(200);
    expect(responsesCreate).toHaveBeenCalledTimes(1);
    expect(body.data).toMatchObject({
      status: "found",
      cityName: "Palo Alto",
      formUrl: "https://www.paloalto.gov/Report-an-Issue",
      confidence: "high",
    });
  });

  it("degrades to not_found when the LLM returns a non-official (non .gov/.us) URL", async () => {
    // Arrange
    vi.spyOn(console, "warn").mockImplementation(() => {});
    fetchWithTimeout.mockResolvedValue(
      reverseResponse("Palo Alto", "California"),
    );
    resolveJurisdiction.mockReturnValue(null);
    responsesCreate.mockResolvedValue(
      llmResponse({
        status: "found",
        formUrl: "https://paloalto.example.com/report",
        reason: "Third-party site.",
        confidence: "high",
      }),
    );

    // Act
    const res = await POST(
      post({
        issueType: IssueType.ROAD_DAMAGE,
        latitude: 37.44,
        longitude: -122.14,
      }),
    );
    const body = await res.json();

    // Assert: isOfficialCityGovUrl rejects the non-gov host -> not_found.
    expect(res.status).toBe(200);
    expect(body.data.status).toBe("not_found");
    expect(body.data.cityName).toBe("Palo Alto");
  });

  it("uses the jurisdiction display name as the LLM hint when a polygon matched without a verified portal", async () => {
    // Arrange: reverse lookup yields no city, polygon matches but has no portal.
    fetchWithTimeout.mockResolvedValue(reverseResponse(null, null));
    resolveJurisdiction.mockReturnValue({
      jurisdiction: { displayName: "Menlo Park" },
      portal: null,
    });
    responsesCreate.mockResolvedValue(
      llmResponse({
        status: "found",
        formUrl: "https://www.menlopark.gov/report",
        reason: "City portal.",
        confidence: "medium",
      }),
    );

    // Act
    const res = await POST(
      post({
        issueType: IssueType.ROAD_DAMAGE,
        latitude: 37.45,
        longitude: -122.18,
      }),
    );
    const body = await res.json();

    // Assert: cityName came from the polygon display name, LLM was consulted.
    expect(responsesCreate).toHaveBeenCalledTimes(1);
    expect(body.data).toMatchObject({
      status: "found",
      cityName: "Menlo Park",
      formUrl: "https://www.menlopark.gov/report",
    });
  });

  it("geocodes the typed address when no coords are supplied", async () => {
    // Arrange: forward geocode (search) returns one hit with coords + city.
    fetchWithTimeout.mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            address: { city: "Palo Alto", state: "California" },
            lat: "37.44",
            lon: "-122.14",
          },
        ]),
        { status: 200 },
      ),
    );
    resolveJurisdiction.mockReturnValue({
      jurisdiction: { displayName: "Palo Alto" },
      portal: {
        url: "https://www.paloalto.gov/311",
        reason: "311 portal.",
        confidence: "high",
      },
    });

    // Act
    const res = await POST(
      post({
        issueType: IssueType.ROAD_DAMAGE,
        address: "123 Main St, Palo Alto",
      }),
    );
    const body = await res.json();

    // Assert: address path resolves the city and the portal is returned.
    expect(fetchWithTimeout).toHaveBeenCalledWith(
      expect.stringContaining("nominatim.openstreetmap.org/search"),
      expect.anything(),
    );
    expect(body.data.status).toBe("found");
    expect(body.data.cityName).toBe("Palo Alto");
  });

  it("returns not_found when no city can be determined from the location", async () => {
    // Arrange: reverse lookup yields no city, no polygon match, no address.
    fetchWithTimeout.mockResolvedValue(reverseResponse(null, null));
    resolveJurisdiction.mockReturnValue(null);

    // Act
    const res = await POST(
      post({ issueType: IssueType.ROAD_DAMAGE, latitude: 0, longitude: 0 }),
    );
    const body = await res.json();

    // Assert
    expect(res.status).toBe(200);
    expect(body.data).toMatchObject({
      status: "not_found",
      cityName: null,
    });
    expect(responsesCreate).not.toHaveBeenCalled();
  });

  it("degrades to not_found when Nominatim errors (graceful upstream failure)", async () => {
    // Arrange: geocoder throws; resolveLocation swallows it -> no city.
    fetchWithTimeout.mockRejectedValue(new Error("nominatim down"));
    resolveJurisdiction.mockReturnValue(null);

    // Act
    const res = await POST(
      post({
        issueType: IssueType.ROAD_DAMAGE,
        latitude: 37.44,
        longitude: -122.14,
      }),
    );
    const body = await res.json();

    // Assert: a hung geocoder degrades to not_found, not a 500.
    expect(res.status).toBe(200);
    expect(body.data.status).toBe("not_found");
  });

  it("returns 500 when the LLM lookup throws", async () => {
    // Arrange
    vi.spyOn(console, "error").mockImplementation(() => {});
    fetchWithTimeout.mockResolvedValue(
      reverseResponse("Palo Alto", "California"),
    );
    resolveJurisdiction.mockReturnValue(null);
    responsesCreate.mockRejectedValue(new Error("openai 500"));

    // Act
    const res = await POST(
      post({
        issueType: IssueType.ROAD_DAMAGE,
        latitude: 37.44,
        longitude: -122.14,
      }),
    );
    const body = await res.json();

    // Assert
    expect(res.status).toBe(500);
    expect(body).toEqual({
      success: false,
      error: "Failed to look up official city form.",
    });
  });
});
