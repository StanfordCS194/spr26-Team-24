import { cookies } from "next/headers";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SESSION_COOKIE, createToken, getSession } from "@/lib/auth";

// Unit test (node project) for getSession(): cookie -> verifyToken wiring.
// next/headers is globally mocked in vitest.setup.tsx with cookies() resolving
// to a store whose get() returns undefined by default; we override get() per
// test to control which cookie value getSession sees. Tokens are signed with
// the test JWT_SECRET set by src/test/env.ts so verifyToken runs for real.

const mockedCookies = vi.mocked(cookies);

// Point the mocked cookies() store's get() at a fixed return value and hand
// back the spy so tests can assert how getSession called it.
function setCookie(value: { value: string } | undefined) {
  const get = vi.fn(() => value);
  mockedCookies.mockResolvedValue({
    get,
  } as unknown as Awaited<ReturnType<typeof cookies>>);
  return get;
}

describe("getSession()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when no session cookie is present", async () => {
    // Arrange
    const get = setCookie(undefined);

    // Act
    const session = await getSession();

    // Assert
    expect(session).toBeNull();
    expect(mockedCookies).toHaveBeenCalledOnce();
    expect(get).toHaveBeenCalledWith(SESSION_COOKIE);
  });

  it("returns the decoded payload for a valid token", async () => {
    // Arrange
    const token = await createToken({
      userId: "user_42",
      email: "valid@example.com",
    });
    const get = setCookie({ value: token });

    // Act
    const session = await getSession();

    // Assert
    expect(get).toHaveBeenCalledWith(SESSION_COOKIE);
    expect(session).toMatchObject({
      userId: "user_42",
      email: "valid@example.com",
    });
  });

  it("returns null for an invalid (unverifiable) token", async () => {
    // Arrange
    setCookie({ value: "not-a-jwt" });

    // Act
    const session = await getSession();

    // Assert
    expect(session).toBeNull();
  });

  it("returns null for an expired token", async () => {
    // Arrange — sign a token that expired in the past with the test secret.
    const { SignJWT } = await import("jose");
    const secret = new TextEncoder().encode(process.env.JWT_SECRET);
    const expired = await new SignJWT({
      userId: "user_1",
      email: "old@example.com",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt(Math.floor(Date.now() / 1000) - 1000)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 10)
      .sign(secret);
    setCookie({ value: expired });

    // Act
    const session = await getSession();

    // Assert
    expect(session).toBeNull();
  });
});
