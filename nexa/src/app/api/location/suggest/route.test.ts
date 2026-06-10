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

function request(query: string): NextRequest {
  return new NextRequest(
    `http://localhost/api/location/suggest?q=${encodeURIComponent(query)}`,
  );
}

describe("GET /api/location/suggest", () => {
  beforeEach(() => {
    // No Google key so the route falls through to the Nominatim branch.
    getGoogleMapsApiKey.mockReturnValue(undefined);
  });

  afterEach(() => {
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
});
