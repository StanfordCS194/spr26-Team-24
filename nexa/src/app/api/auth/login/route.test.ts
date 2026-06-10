import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { makeUser } from "@/test/factories/user";
import { prismaMock } from "@/test/prisma-mock";

// bcrypt.compare is mocked so we drive the success/failure branch deterministically
// without depending on a real hash. `createToken` (jose) runs for real against the
// JWT_SECRET set by the test env, producing a genuine cookie value.
vi.mock("bcryptjs", () => ({
  default: { compare: vi.fn(), hash: vi.fn() },
}));
import bcrypt from "bcryptjs";

import { SESSION_COOKIE } from "@/lib/auth";
import { POST } from "./route";

const compare = vi.mocked(bcrypt.compare);

function loginRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/auth/login", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("POST /api/auth/login", () => {
  beforeEach(() => {
    compare.mockReset();
  });

  it("returns 400 when email or password is missing", async () => {
    // Arrange
    const request = loginRequest({ email: "" });

    // Act
    const response = await POST(request);
    const body = await response.json();

    // Assert
    expect(response.status).toBe(400);
    expect(body).toEqual({
      success: false,
      error: "Email and password are required",
    });
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });

  it("logs in an existing user, sets an httpOnly session cookie, and returns the profile", async () => {
    // Arrange
    const user = makeUser({
      id: "user_login",
      email: "person@example.com",
      name: "Real Person",
      passwordHash: "$2a$10$storedhash",
    });
    prismaMock.user.findUnique.mockResolvedValue(user);
    compare.mockResolvedValue(true as never);

    const request = loginRequest({
      email: "person@example.com",
      password: "correct-horse",
    });

    // Act
    const response = await POST(request);
    const body = await response.json();

    // Assert
    expect(response.status).toBe(200);
    expect(body).toEqual({
      success: true,
      data: {
        id: "user_login",
        email: "person@example.com",
        name: "Real Person",
      },
    });
    // Password IS compared against the stored hash (current real behavior).
    expect(compare).toHaveBeenCalledWith("correct-horse", "$2a$10$storedhash");

    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`${SESSION_COOKIE}=`);
    expect(setCookie.toLowerCase()).toContain("httponly");
  });

  it("returns 401 with a generic message when the email is unknown", async () => {
    // Arrange
    prismaMock.user.findUnique.mockResolvedValue(null);

    const request = loginRequest({
      email: "nobody@example.com",
      password: "whatever",
    });

    // Act
    const response = await POST(request);
    const body = await response.json();

    // Assert
    expect(response.status).toBe(401);
    expect(body).toEqual({
      success: false,
      error: "Invalid email or password",
    });
    // No password to compare against — bail before bcrypt.
    expect(compare).not.toHaveBeenCalled();
  });

  it("returns 401 when the password does not match", async () => {
    // Arrange
    const user = makeUser({ passwordHash: "$2a$10$storedhash" });
    prismaMock.user.findUnique.mockResolvedValue(user);
    compare.mockResolvedValue(false as never);

    const request = loginRequest({
      email: user.email,
      password: "wrong-password",
    });

    // Act
    const response = await POST(request);
    const body = await response.json();

    // Assert
    expect(response.status).toBe(401);
    expect(body).toEqual({
      success: false,
      error: "Invalid email or password",
    });
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("returns 500 when the database lookup throws", async () => {
    // Arrange
    prismaMock.user.findUnique.mockRejectedValue(new Error("db down"));

    const request = loginRequest({ email: "a@b.com", password: "secret123" });

    // Act
    const response = await POST(request);
    const body = await response.json();

    // Assert
    expect(response.status).toBe(500);
    expect(body).toEqual({
      success: false,
      error: "Login failed. Please try again.",
    });
  });
});
