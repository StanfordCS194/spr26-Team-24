import { beforeEach, describe, expect, it, vi } from "vitest";

// The route reads the caller's identity via getSession(); mock the auth module
// so we control "logged out" vs "logged in" without minting/decoding a JWT.
vi.mock("@/lib/auth", () => ({ getSession: vi.fn() }));
import { getSession } from "@/lib/auth";

import { GET } from "./route";

const mockedGetSession = vi.mocked(getSession);

describe("GET /api/auth/me", () => {
  beforeEach(() => {
    mockedGetSession.mockReset();
  });

  it("returns 401 when there is no session", async () => {
    // Arrange
    mockedGetSession.mockResolvedValue(null);

    // Act
    const response = await GET();
    const body = await response.json();

    // Assert
    expect(response.status).toBe(401);
    expect(body).toEqual({ success: false, error: "Not authenticated" });
  });

  it("returns the session identity with a name derived from the email", async () => {
    // Arrange
    mockedGetSession.mockResolvedValue({
      userId: "user_42",
      email: "ada@example.com",
    });

    // Act
    const response = await GET();
    const body = await response.json();

    // Assert
    expect(response.status).toBe(200);
    expect(body).toEqual({
      success: true,
      // name is the local-part of the email (everything before the @).
      data: { id: "user_42", email: "ada@example.com", name: "ada" },
    });
  });
});
