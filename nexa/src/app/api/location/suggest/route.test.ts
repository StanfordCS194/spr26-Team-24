import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Drive the Nominatim path (no Google key) and control its fetch so we can
// distinguish a genuinely-empty result from an upstream failure without any
// real network. `vi.hoisted` lets the hoisted `vi.mock` factories reference the
// spies without a TDZ error.
const { getGoogleMapsApiKey, fetchWithTimeout } = vi.hoisted(() => ({
  getGoogleMapsApiKey: vi.fn(),
  fetchWithTimeout: vi.fn(),
}));

vi.mock("@/lib/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/config")>();
  return { ...actual, getGoogleMapsApiKey };
});

vi.mock("@/lib/http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/http")>();
  return { ...actual, fetchWithTimeout };
});

import { GET } from "./route";
import { __resetRateLimitStore } from "@/lib/rate-limit";

function request(query: string): NextRequest {
  return new NextRequest(
    `http://localhost/api/location/suggest?q=${encodeURIComponent(query)}`,
    { headers: { "x-forwarded-for": "10.2.0.1" } },
  );
}

describe("GET /api/location/suggest", () => {
  beforeEach(() => {
    __resetRateLimitStore();
    // No Google key so the route falls through to the Nominatim branch.
    getGoogleMapsApiKey.mockReturnValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("returns an empty success for a too-short query", async () => {
    const response = await GET(request("ab"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true, data: { suggestions: [] } });
    expect(fetchWithTimeout).not.toHaveBeenCalled();
  });

  it("returns an empty success when the geocoder legitimately has no matches", async () => {
    fetchWithTimeout.mockResolvedValue(
      new Response(JSON.stringify([]), { status: 200 }),
    );

    const response = await GET(request("nowhere at all"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true, data: { suggestions: [] } });
  });

  it("surfaces an upstream failure as a 500 envelope error, not an empty success", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    // A non-array body makes `.map` throw inside the route, exercising the catch.
    fetchWithTimeout.mockResolvedValue(
      new Response(JSON.stringify({ boom: true }), { status: 200 }),
    );

    const response = await GET(request("123 Main Street"));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.success).toBe(false);
    expect(body.error).toBe("Failed to look up location suggestions.");
    expect(body).not.toHaveProperty("data");

    errorSpy.mockRestore();
  });

  it("maps Google autocomplete + details to the top-5 suggestions when a key is set", async () => {
    // Arrange: a Google key is present, so the route uses the Google branch.
    getGoogleMapsApiKey.mockReturnValue("g-key");
    fetchWithTimeout.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/autocomplete/json")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              status: "OK",
              predictions: [
                { description: "1 Main St", place_id: "p1" },
                { description: "2 Main St", place_id: "p2" },
              ],
            }),
            { status: 200 },
          ),
        );
      }
      // Place details: a different fixed location per place_id.
      const lat = url.includes("place_id=p1") ? 37.1 : 37.2;
      return Promise.resolve(
        new Response(
          JSON.stringify({
            status: "OK",
            result: {
              formatted_address:
                lat === 37.1 ? "1 Main St, CA" : "2 Main St, CA",
              geometry: { location: { lat, lng: -122.0 } },
            },
          }),
          { status: 200 },
        ),
      );
    });

    // Act
    const res = await GET(request("1 Main"));
    const body = await res.json();

    // Assert: each prediction mapped to {displayName, latitude, longitude}.
    expect(res.status).toBe(200);
    expect(body.data.suggestions).toEqual([
      { displayName: "1 Main St, CA", latitude: 37.1, longitude: -122.0 },
      { displayName: "2 Main St, CA", latitude: 37.2, longitude: -122.0 },
    ]);
  });

  it("falls back to Nominatim when Google returns no usable predictions", async () => {
    // Arrange: Google key set but autocomplete is empty -> Nominatim fallback.
    getGoogleMapsApiKey.mockReturnValue("g-key");
    fetchWithTimeout.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("maps.googleapis.com")) {
        return Promise.resolve(
          new Response(JSON.stringify({ status: "ZERO_RESULTS" }), {
            status: 200,
          }),
        );
      }
      // Nominatim hit.
      return Promise.resolve(
        new Response(
          JSON.stringify([
            { display_name: "Nominatim Pl", lat: "37.5", lon: "-122.3" },
          ]),
          { status: 200 },
        ),
      );
    });

    // Act
    const res = await GET(request("somewhere"));
    const body = await res.json();

    // Assert
    expect(body.data.suggestions).toEqual([
      { displayName: "Nominatim Pl", latitude: 37.5, longitude: -122.3 },
    ]);
  });

  it("returns a 429 with a Retry-After header when the rate limit is exceeded", async () => {
    // Arrange: a limit of 1 means the second call from the same IP is blocked.
    vi.stubEnv("RATE_LIMIT_MAX", "1");

    // Act: first request consumes the single allowed slot.
    const first = await GET(request("first call"));
    const second = await GET(request("second call"));

    // Assert
    expect(first.status).toBe(200);
    expect(second.status).toBe(429);
    expect(second.headers.get("Retry-After")).toBeTruthy();
    const body = await second.json();
    expect(body.code).toBe("RATE_LIMITED");
  });
});
