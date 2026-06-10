import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MissingEnvError } from "@/lib/config";

import { createToken, verifyToken, type SessionPayload } from "./auth";

// auth.ts reads the JWT secret via @/lib/config's getJwtSecret (cached/memoized
// in the real module). We mock that one getter so each test controls the secret
// deterministically — including simulating a missing JWT_SECRET — without
// touching process.env or fighting the cache. The real jose library still
// signs/verifies, so the round-trip and tamper/expiry behavior is exercised
// end to end.
const getJwtSecret = vi.fn(() => "unit-test-secret");
vi.mock("@/lib/config", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/config")>("@/lib/config");
  return { ...actual, getJwtSecret: () => getJwtSecret() };
});

const payload: SessionPayload = {
  userId: "user-123",
  email: "person@example.com",
};

describe("createToken / verifyToken", () => {
  beforeEach(() => {
    getJwtSecret.mockReturnValue("unit-test-secret");
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("round-trips the userId and email through a signed token", async () => {
    // Arrange / Act
    const token = await createToken(payload);
    const decoded = await verifyToken(token);

    // Assert
    expect(decoded?.userId).toBe(payload.userId);
    expect(decoded?.email).toBe(payload.email);
  });

  it("produces a three-segment HS256 JWT string", async () => {
    // Arrange / Act
    const token = await createToken(payload);

    // Assert: header.payload.signature.
    expect(token.split(".")).toHaveLength(3);
  });

  it("returns null for a token signed with a different secret (tampered/invalid signature)", async () => {
    // Arrange: sign under one secret, verify under another.
    getJwtSecret.mockReturnValue("secret-A");
    const token = await createToken(payload);
    getJwtSecret.mockReturnValue("secret-B");

    // Act
    const decoded = await verifyToken(token);

    // Assert
    expect(decoded).toBeNull();
  });

  it("returns null for a structurally malformed token", async () => {
    // Arrange / Act
    const decoded = await verifyToken("not.a.jwt");

    // Assert
    expect(decoded).toBeNull();
  });

  it("returns null for an expired token", async () => {
    // Arrange: mint a token, then advance time past the 7-day expiry.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const token = await createToken(payload);
    // 8 days later — beyond the 7d expiry baked into createToken.
    vi.setSystemTime(new Date("2026-01-09T00:00:00Z"));

    // Act
    const decoded = await verifyToken(token);

    // Assert
    expect(decoded).toBeNull();
  });

  it("throws when the JWT secret is missing (observed through createToken)", async () => {
    // Arrange: getJwtSecret throws MissingEnvError when JWT_SECRET is unset.
    getJwtSecret.mockImplementation(() => {
      throw new MissingEnvError("JWT_SECRET");
    });

    // Act / Assert
    await expect(createToken(payload)).rejects.toThrow(MissingEnvError);
  });
});
