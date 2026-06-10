import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { SESSION_COOKIE, createToken } from "@/lib/auth";

import { config, proxy } from "./proxy";

// Unit test (node project) for the Next.js auth middleware. We exercise every
// branch by constructing a real NextRequest, attaching (or omitting) the
// session cookie, and signing a genuine JWT with the test JWT_SECRET that
// src/test/env.ts sets — so verifyToken runs for real, no mocking needed.

const BASE = "http://localhost";

// Build a NextRequest for `path`, optionally carrying a session cookie value.
function makeRequest(path: string, sessionToken?: string): NextRequest {
  const request = new NextRequest(new URL(path, BASE));
  if (sessionToken !== undefined) {
    request.cookies.set(SESSION_COOKIE, sessionToken);
  }
  return request;
}

// A real, valid 7-day token signed with the test secret.
async function validToken(): Promise<string> {
  return createToken({ userId: "user_1", email: "a@example.com" });
}

describe("proxy() middleware", () => {
  describe("protected routes", () => {
    it.each(["/report", "/dashboard", "/dashboard/reports/abc", "/report/new"])(
      "redirects %s with no session to /login preserving redirect=path",
      async (path) => {
        // Arrange
        const request = makeRequest(path);

        // Act
        const response = await proxy(request);
        const location = new URL(response.headers.get("location")!);

        // Assert
        expect(response.status).toBe(307);
        expect(location.pathname).toBe("/login");
        expect(location.searchParams.get("redirect")).toBe(path);
      },
    );

    it("redirects to /login when the session cookie is an invalid token", async () => {
      // Arrange — a cookie present but not a verifiable JWT.
      const request = makeRequest("/dashboard", "not-a-real-jwt");

      // Act
      const response = await proxy(request);
      const location = new URL(response.headers.get("location")!);

      // Assert
      expect(response.status).toBe(307);
      expect(location.pathname).toBe("/login");
      expect(location.searchParams.get("redirect")).toBe("/dashboard");
    });

    it("calls next() (no redirect) for a protected route with a valid session", async () => {
      // Arrange
      const request = makeRequest("/dashboard", await validToken());

      // Act
      const response = await proxy(request);

      // Assert — NextResponse.next() carries no location and is not a redirect.
      expect(response.headers.get("location")).toBeNull();
      expect(response.status).toBe(200);
      expect(response.headers.get("x-middleware-next")).toBe("1");
    });
  });

  describe("auth routes", () => {
    it.each(["/login", "/register"])(
      "redirects %s to / when already logged in",
      async (path) => {
        // Arrange
        const request = makeRequest(path, await validToken());

        // Act
        const response = await proxy(request);
        const location = new URL(response.headers.get("location")!);

        // Assert
        expect(response.status).toBe(307);
        expect(location.pathname).toBe("/");
        expect(location.searchParams.has("redirect")).toBe(false);
      },
    );

    it.each(["/login", "/register"])(
      "calls next() for %s with no session",
      async (path) => {
        // Arrange
        const request = makeRequest(path);

        // Act
        const response = await proxy(request);

        // Assert
        expect(response.headers.get("location")).toBeNull();
        expect(response.headers.get("x-middleware-next")).toBe("1");
      },
    );

    it("calls next() for an auth route when the cookie token is invalid", async () => {
      // Arrange — invalid token means no session, so the auth route is shown.
      const request = makeRequest("/login", "garbage");

      // Act
      const response = await proxy(request);

      // Assert
      expect(response.headers.get("location")).toBeNull();
      expect(response.headers.get("x-middleware-next")).toBe("1");
    });
  });

  describe("prefix (startsWith) semantics", () => {
    it("treats /reportage as protected because it starts with /report", async () => {
      // Arrange — documents the as-implemented startsWith behavior.
      const request = makeRequest("/reportage");

      // Act
      const response = await proxy(request);
      const location = new URL(response.headers.get("location")!);

      // Assert
      expect(response.status).toBe(307);
      expect(location.pathname).toBe("/login");
      expect(location.searchParams.get("redirect")).toBe("/reportage");
    });

    it("does NOT treat /registerish as an auth route redirect when logged out", async () => {
      // Arrange — startsWith would match, but with no session auth routes pass
      // through; this asserts a logged-out user is not bounced.
      const request = makeRequest("/registerish");

      // Act
      const response = await proxy(request);

      // Assert
      expect(response.headers.get("location")).toBeNull();
      expect(response.headers.get("x-middleware-next")).toBe("1");
    });
  });

  describe("pass-through (non-protected, non-auth) paths", () => {
    it.each(["/", "/about", "/api/health"])(
      "calls next() for %s regardless of session",
      async (path) => {
        // Arrange
        const request = makeRequest(path);

        // Act
        const response = await proxy(request);

        // Assert
        expect(response.headers.get("location")).toBeNull();
        expect(response.headers.get("x-middleware-next")).toBe("1");
      },
    );

    it("calls next() for a pass-through path even with a valid session", async () => {
      // Arrange
      const request = makeRequest("/about", await validToken());

      // Act
      const response = await proxy(request);

      // Assert
      expect(response.headers.get("location")).toBeNull();
      expect(response.headers.get("x-middleware-next")).toBe("1");
    });
  });
});

describe("config.matcher", () => {
  it("is a single negative-lookahead matcher excluding Next internals and static assets", () => {
    // Assert
    expect(config.matcher).toEqual([
      "/((?!_next/static|_next/image|favicon.ico|public).*)",
    ]);
  });

  it.each([
    "_next/static/chunk.js",
    "_next/image",
    "favicon.ico",
    "public/logo.png",
  ])("does not match excluded asset path %s", (path) => {
    // Arrange — reconstruct the matcher regex and anchor it like Next does.
    const pattern = new RegExp(`^${config.matcher[0]}$`);

    // Act / Assert — the negative lookahead means these are NOT matched.
    expect(pattern.test(`/${path}`)).toBe(false);
  });

  it.each(["/", "/report", "/dashboard/x", "/login"])(
    "matches application path %s",
    (path) => {
      // Arrange
      const pattern = new RegExp(`^${config.matcher[0]}$`);

      // Act / Assert
      expect(pattern.test(path)).toBe(true);
    },
  );
});
