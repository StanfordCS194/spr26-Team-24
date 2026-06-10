import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionPayload } from "@/lib/auth";

// The admin gate reads the allowlist via @/lib/config's getAdminEmails (cached
// in the real module) and the session via @/lib/auth's getSession. We mock both
// so each test controls the allowlist and the "logged-in" user deterministically
// without touching process.env or the real cookie store.
const adminEmails = vi.fn<() => Set<string>>(() => new Set<string>());
vi.mock("@/lib/config", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/config")>("@/lib/config");
  return { ...actual, getAdminEmails: () => adminEmails() };
});

const getSession = vi.fn<() => Promise<SessionPayload | null>>(
  async () => null,
);
vi.mock("@/lib/auth", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth");
  return { ...actual, getSession: () => getSession() };
});

import { isAdminEmail, isAdminSession, requireAdmin } from "./admin";

beforeEach(() => {
  adminEmails.mockReturnValue(new Set(["admin@nexa.test"]));
  getSession.mockResolvedValue(null);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("isAdminEmail", () => {
  it("is true for an allowlisted email", () => {
    expect(isAdminEmail("admin@nexa.test")).toBe(true);
  });

  it("is case-insensitive and trims whitespace", () => {
    expect(isAdminEmail("  ADMIN@NEXA.TEST ")).toBe(true);
  });

  it("is false for a non-allowlisted email", () => {
    expect(isAdminEmail("user@nexa.test")).toBe(false);
  });

  it("is false for null/undefined/empty", () => {
    expect(isAdminEmail(null)).toBe(false);
    expect(isAdminEmail(undefined)).toBe(false);
    expect(isAdminEmail("")).toBe(false);
  });

  it("admits nobody when the allowlist is empty", () => {
    adminEmails.mockReturnValue(new Set());
    expect(isAdminEmail("admin@nexa.test")).toBe(false);
  });
});

describe("isAdminSession", () => {
  it("is true for an admin session", () => {
    expect(isAdminSession({ userId: "1", email: "admin@nexa.test" })).toBe(
      true,
    );
  });

  it("is false for a non-admin session", () => {
    expect(isAdminSession({ userId: "2", email: "user@nexa.test" })).toBe(
      false,
    );
  });

  it("is false for a null session", () => {
    expect(isAdminSession(null)).toBe(false);
  });
});

describe("requireAdmin", () => {
  it("returns the session for an admin", async () => {
    const session = { userId: "1", email: "admin@nexa.test" };
    getSession.mockResolvedValue(session);
    await expect(requireAdmin()).resolves.toEqual(session);
  });

  it("returns null for a logged-in non-admin (never the session)", async () => {
    getSession.mockResolvedValue({ userId: "2", email: "user@nexa.test" });
    await expect(requireAdmin()).resolves.toBeNull();
  });

  it("returns null when no one is logged in", async () => {
    getSession.mockResolvedValue(null);
    await expect(requireAdmin()).resolves.toBeNull();
  });
});
