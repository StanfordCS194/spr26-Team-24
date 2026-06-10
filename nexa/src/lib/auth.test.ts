import { SignJWT } from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MissingEnvError } from "@/lib/config";

import { createToken, verifyToken, type SessionPayload } from "./auth";

// Sign an arbitrary (possibly malformed) payload under the active test secret so
// we can exercise verifyToken's runtime claim validation on a signature-valid
// but wrong-shaped token.
async function signRaw(claims: Record<string, unknown>): Promise<string> {
  const secret = new TextEncoder().encode("unit-test-secret");
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secret);
}

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

  it("returns null for a signature-valid token whose payload is missing userId", async () => {
    // Arrange: a properly signed token that lacks userId — previously this was
    // cast straight through as a SessionPayload with userId === undefined.
    const token = await signRaw({ email: "person@example.com" });

    // Act
    const decoded = await verifyToken(token);

    // Assert
    expect(decoded).toBeNull();
  });

  it("returns null for a signature-valid token whose payload is missing email", async () => {
    // Arrange
    const token = await signRaw({ userId: "user-123" });

    // Act / Assert
    expect(await verifyToken(token)).toBeNull();
  });

  it("returns null when userId/email are present but the wrong type", async () => {
    // Arrange: userId is a number, email is null — not a usable session.
    const token = await signRaw({ userId: 7, email: null });

    // Act / Assert
    expect(await verifyToken(token)).toBeNull();
  });

  it("returns null when userId/email are empty strings", async () => {
    // Arrange: present but empty — there is no real user to identify.
    const token = await signRaw({ userId: "", email: "" });

    // Act / Assert
    expect(await verifyToken(token)).toBeNull();
  });

  it("returns only userId/email, dropping extra claims from the token", async () => {
    // Arrange: a valid session plus an unexpected extra claim and jose's iat/exp.
    const token = await signRaw({
      userId: "user-123",
      email: "person@example.com",
      role: "admin",
    });

    // Act
    const decoded = await verifyToken(token);

    // Assert: the returned payload is exactly the SessionPayload shape.
    expect(decoded).toEqual({
      userId: "user-123",
      email: "person@example.com",
    });
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
