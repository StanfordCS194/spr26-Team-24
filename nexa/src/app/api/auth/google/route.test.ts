// Configure Google OAuth before the route module reads the (cached) config.
process.env.GOOGLE_OAUTH_CLIENT_ID = "test-client-id";
process.env.GOOGLE_OAUTH_CLIENT_SECRET = "test-client-secret";

import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { GOOGLE_AUTH_ENDPOINT, OAUTH_STATE_COOKIE } from "@/lib/google-oauth";
import { GET } from "./route";

describe("GET /api/auth/google", () => {
  it("redirects to Google's consent screen and sets a state cookie", async () => {
    const request = new NextRequest(
      "http://localhost/api/auth/google?redirect=/dashboard",
    );
    const res = await GET(request);

    const location = res.headers.get("location") ?? "";
    expect(location).toContain(GOOGLE_AUTH_ENDPOINT);

    const authUrl = new URL(location);
    expect(authUrl.searchParams.get("client_id")).toBe("test-client-id");
    expect(authUrl.searchParams.get("redirect_uri")).toBe(
      "http://localhost/api/auth/google/callback",
    );
    // A CSRF state is minted and round-tripped via both the URL and a cookie.
    const state = authUrl.searchParams.get("state");
    expect(state).toBeTruthy();
    expect(res.cookies.get(OAUTH_STATE_COOKIE)?.value).toBe(state);
  });
});
