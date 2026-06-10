// Configure Google OAuth before the route module reads the (cached) config.
process.env.GOOGLE_OAUTH_CLIENT_ID = "test-client-id";
process.env.GOOGLE_OAUTH_CLIENT_SECRET = "test-client-secret";

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { prismaMock } from "@/test/prisma-mock";
import { SESSION_COOKIE } from "@/lib/auth";
import {
  GOOGLE_TOKEN_ENDPOINT,
  OAUTH_STATE_COOKIE,
  OAUTH_REDIRECT_COOKIE,
} from "@/lib/google-oauth";
import { GET } from "./route";

function callbackRequest(opts: {
  query?: string;
  cookies?: Record<string, string>;
}): NextRequest {
  const cookieHeader = Object.entries(opts.cookies ?? {})
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
  return new NextRequest(
    `http://localhost/api/auth/google/callback${opts.query ?? ""}`,
    { headers: cookieHeader ? { cookie: cookieHeader } : {} },
  );
}

const location = (res: Response) => res.headers.get("location") ?? "";

// Stub fetch so the token + userinfo calls resolve without the network.
function stubGoogleFetch(userinfo: unknown, opts: { tokenOk?: boolean } = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === GOOGLE_TOKEN_ENDPOINT) {
        return {
          ok: opts.tokenOk ?? true,
          json: async () => ({ access_token: "tok" }),
        };
      }
      return { ok: true, json: async () => userinfo };
    }),
  );
}

describe("GET /api/auth/google/callback", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("redirects to /login?error=google_denied when the user denies consent", async () => {
    const res = await GET(callbackRequest({ query: "?error=access_denied" }));
    expect(res.status).toBe(307);
    expect(location(res)).toContain("/login?error=google_denied");
  });

  it("rejects a state that does not match the cookie (CSRF guard)", async () => {
    const res = await GET(
      callbackRequest({
        query: "?code=abc&state=forged",
        cookies: { [OAUTH_STATE_COOKIE]: "real" },
      }),
    );
    expect(location(res)).toContain("/login?error=google_state");
  });

  it("rejects a missing code", async () => {
    const res = await GET(
      callbackRequest({
        query: "?state=s",
        cookies: { [OAUTH_STATE_COOKIE]: "s" },
      }),
    );
    expect(location(res)).toContain("/login?error=google_state");
  });

  it("rejects an unverified Google email", async () => {
    stubGoogleFetch({ email: "a@b.com", email_verified: false });
    const res = await GET(
      callbackRequest({
        query: "?code=abc&state=s",
        cookies: { [OAUTH_STATE_COOKIE]: "s" },
      }),
    );
    expect(location(res)).toContain("/login?error=google_unverified");
  });

  it("upserts the user and sets the session cookie on success", async () => {
    stubGoogleFetch({
      email: "Ada@Example.com",
      email_verified: true,
      name: "Ada",
    });
    prismaMock.user.upsert.mockResolvedValue({
      id: "user_1",
      email: "ada@example.com",
    } as never);

    const res = await GET(
      callbackRequest({
        query: "?code=abc&state=s",
        cookies: {
          [OAUTH_STATE_COOKIE]: "s",
          [OAUTH_REDIRECT_COOKIE]: "/dashboard",
        },
      }),
    );

    // Matched by lower-cased email; created without a password.
    expect(prismaMock.user.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: "ada@example.com" } }),
    );
    expect(res.status).toBe(307);
    expect(location(res)).toContain("/dashboard");
    expect(res.cookies.get(SESSION_COOKIE)?.value).toBeTruthy();
  });

  it("redirects to google_failed when the token exchange fails", async () => {
    stubGoogleFetch({}, { tokenOk: false });
    const res = await GET(
      callbackRequest({
        query: "?code=abc&state=s",
        cookies: { [OAUTH_STATE_COOKIE]: "s" },
      }),
    );
    expect(location(res)).toContain("/login?error=google_failed");
  });
});
