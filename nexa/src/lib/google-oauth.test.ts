import { describe, expect, it, vi } from "vitest";

import {
  buildGoogleAuthUrl,
  fetchGoogleUser,
  GOOGLE_AUTH_ENDPOINT,
  GOOGLE_TOKEN_ENDPOINT,
  GOOGLE_USERINFO_ENDPOINT,
} from "./google-oauth";

describe("buildGoogleAuthUrl", () => {
  it("targets the consent endpoint with the expected params", () => {
    const url = new URL(
      buildGoogleAuthUrl({
        clientId: "client-123",
        redirectUri: "https://nexa.app/api/auth/google/callback",
        state: "state-abc",
      }),
    );

    expect(`${url.origin}${url.pathname}`).toBe(GOOGLE_AUTH_ENDPOINT);
    expect(url.searchParams.get("client_id")).toBe("client-123");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://nexa.app/api/auth/google/callback",
    );
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("state")).toBe("state-abc");
    expect(url.searchParams.get("scope")).toContain("email");
  });
});

// Builds a fetch stub that returns the token response on the token endpoint and
// the userinfo response on the userinfo endpoint.
function stubFetch(opts: {
  token?: { ok: boolean; body: unknown };
  userinfo?: { ok: boolean; body: unknown };
}): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const target = typeof input === "string" ? input : input.toString();
    const pick = target === GOOGLE_TOKEN_ENDPOINT ? opts.token : opts.userinfo;
    return {
      ok: pick?.ok ?? true,
      json: async () => pick?.body ?? {},
    };
  }) as unknown as typeof fetch;
}

const baseParams = {
  clientId: "c",
  clientSecret: "s",
  code: "auth-code",
  redirectUri: "https://nexa.app/api/auth/google/callback",
};

describe("fetchGoogleUser", () => {
  it("returns the verified user on the happy path", async () => {
    const result = await fetchGoogleUser({
      ...baseParams,
      fetchImpl: stubFetch({
        token: { ok: true, body: { access_token: "tok" } },
        userinfo: {
          ok: true,
          body: {
            email: "User@Example.com",
            email_verified: true,
            name: "Ada",
          },
        },
      }),
    });

    expect(result).toEqual({
      status: "ok",
      user: { email: "user@example.com", name: "Ada", emailVerified: true },
    });
  });

  it("treats email_verified: 'true' (string) as verified", async () => {
    const result = await fetchGoogleUser({
      ...baseParams,
      fetchImpl: stubFetch({
        token: { ok: true, body: { access_token: "tok" } },
        userinfo: {
          ok: true,
          body: { email: "a@b.com", email_verified: "true" },
        },
      }),
    });

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.user.emailVerified).toBe(true);
      expect(result.user.name).toBeNull();
    }
  });

  it("errors when the token exchange is rejected", async () => {
    const result = await fetchGoogleUser({
      ...baseParams,
      fetchImpl: stubFetch({ token: { ok: false, body: {} } }),
    });
    expect(result.status).toBe("error");
  });

  it("errors when no access token comes back", async () => {
    const result = await fetchGoogleUser({
      ...baseParams,
      fetchImpl: stubFetch({ token: { ok: true, body: { not_a_token: 1 } } }),
    });
    expect(result.status).toBe("error");
  });

  it("errors when the userinfo request is rejected", async () => {
    const result = await fetchGoogleUser({
      ...baseParams,
      fetchImpl: stubFetch({
        token: { ok: true, body: { access_token: "tok" } },
        userinfo: { ok: false, body: {} },
      }),
    });
    expect(result.status).toBe("error");
  });

  it("errors when the profile is missing an email", async () => {
    const result = await fetchGoogleUser({
      ...baseParams,
      fetchImpl: stubFetch({
        token: { ok: true, body: { access_token: "tok" } },
        userinfo: { ok: true, body: { name: "No Email" } },
      }),
    });
    expect(result.status).toBe("error");
  });

  it("reports an unverified email rather than throwing", async () => {
    const result = await fetchGoogleUser({
      ...baseParams,
      fetchImpl: stubFetch({
        token: { ok: true, body: { access_token: "tok" } },
        userinfo: {
          ok: true,
          body: { email: "a@b.com", email_verified: false },
        },
      }),
    });
    expect(result.status).toBe("ok");
    if (result.status === "ok") expect(result.user.emailVerified).toBe(false);
  });

  it("errors (not throws) when the network is unreachable", async () => {
    const exploding = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    const result = await fetchGoogleUser({
      ...baseParams,
      fetchImpl: exploding,
    });
    expect(result.status).toBe("error");
  });

  it("uses the userinfo endpoint with a bearer token", async () => {
    const seen: Array<{ url: string; init?: RequestInit }> = [];
    const recording = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        seen.push({ url, init });
        const body =
          url === GOOGLE_TOKEN_ENDPOINT
            ? { access_token: "tok-xyz" }
            : { email: "a@b.com", email_verified: true };
        return { ok: true, json: async () => body };
      },
    ) as unknown as typeof fetch;

    await fetchGoogleUser({ ...baseParams, fetchImpl: recording });

    const infoCall = seen.find((c) => c.url === GOOGLE_USERINFO_ENDPOINT);
    expect(infoCall).toBeDefined();
    const headers = infoCall?.init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer tok-xyz");
  });
});
