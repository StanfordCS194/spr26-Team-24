import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { makeUser } from "@/test/factories/user";
import { prismaMock } from "@/test/prisma-mock";

// bcrypt.hash is mocked so the test never runs a real (slow) hash and we can
// assert it is invoked with the supplied password. createToken (jose) runs for
// real against the JWT_SECRET from the test env.
vi.mock("bcryptjs", () => ({
  default: { hash: vi.fn(), compare: vi.fn() },
}));
import bcrypt from "bcryptjs";

import { SESSION_COOKIE } from "@/lib/auth";
import { POST } from "./route";

const hash = vi.mocked(bcrypt.hash);

function registerRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/auth/register", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("POST /api/auth/register", () => {
  beforeEach(() => {
    hash.mockReset();
    hash.mockResolvedValue("hashed-password" as never);
  });

  it("returns 400 when email or password is missing", async () => {
    // Arrange
    const request = registerRequest({ email: "a@b.com" });

    // Act
    const response = await POST(request);
    const body = await response.json();

    // Assert
    expect(response.status).toBe(400);
    expect(body).toEqual({
      success: false,
      error: "Email and password are required",
    });
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });

  it("returns 400 when the password is shorter than 8 characters", async () => {
    // Arrange
    const request = registerRequest({ email: "a@b.com", password: "short" });

    // Act
    const response = await POST(request);
    const body = await response.json();

    // Assert
    expect(response.status).toBe(400);
    expect(body).toEqual({
      success: false,
      error: "Password must be at least 8 characters",
    });
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });

  it("returns 409 when an account with the email already exists", async () => {
    // Arrange
    prismaMock.user.findUnique.mockResolvedValue(makeUser());

    const request = registerRequest({
      email: "taken@example.com",
      password: "longenough",
    });

    // Act
    const response = await POST(request);
    const body = await response.json();

    // Assert
    expect(response.status).toBe(409);
    expect(body).toEqual({
      success: false,
      error: "An account with this email already exists",
    });
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });

  it("hashes the password, creates the user, sets the cookie, and returns 201", async () => {
    // Arrange
    prismaMock.user.findUnique.mockResolvedValue(null);
    const created = makeUser({
      id: "user_new",
      email: "new@example.com",
      name: "Newbie",
    });
    prismaMock.user.create.mockResolvedValue(created);

    const request = registerRequest({
      name: "Newbie",
      email: "new@example.com",
      password: "longenough",
    });

    // Act
    const response = await POST(request);
    const body = await response.json();

    // Assert
    expect(response.status).toBe(201);
    expect(body).toEqual({
      success: true,
      data: { id: "user_new", email: "new@example.com", name: "Newbie" },
    });
    expect(hash).toHaveBeenCalledWith("longenough", 10);
    expect(prismaMock.user.create).toHaveBeenCalledWith({
      data: {
        email: "new@example.com",
        name: "Newbie",
        passwordHash: "hashed-password",
      },
    });

    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`${SESSION_COOKIE}=`);
    expect(setCookie.toLowerCase()).toContain("httponly");
  });

  it("stores name as null when none is supplied", async () => {
    // Arrange
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.user.create.mockResolvedValue(makeUser({ name: null }));

    const request = registerRequest({
      email: "anon@example.com",
      password: "longenough",
    });

    // Act
    await POST(request);

    // Assert
    expect(prismaMock.user.create).toHaveBeenCalledWith({
      data: {
        email: "anon@example.com",
        name: null,
        passwordHash: "hashed-password",
      },
    });
  });

  it("returns 500 when the database write throws", async () => {
    // Arrange
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.user.create.mockRejectedValue(new Error("db down"));

    const request = registerRequest({
      email: "boom@example.com",
      password: "longenough",
    });

    // Act
    const response = await POST(request);
    const body = await response.json();

    // Assert
    expect(response.status).toBe(500);
    expect(body).toEqual({
      success: false,
      error: "Registration failed. Please try again.",
    });
  });
});
