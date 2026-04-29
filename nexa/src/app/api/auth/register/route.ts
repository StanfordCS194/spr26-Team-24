// POST /api/auth/register
// Creates a new user account, then issues a session cookie so the user is immediately logged in.
// Returns the created user (without the password hash) or an error.

import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { createToken, SESSION_COOKIE, cookieOptions } from "@/lib/auth";

export async function POST(request: NextRequest) {
  try {
    const { name, email, password } = await request.json();

    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password are required" },
        { status: 400 },
      );
    }

    if (password.length < 8) {
      return NextResponse.json(
        { error: "Password must be at least 8 characters" },
        { status: 400 },
      );
    }

    // Check if this email is already taken before doing the expensive hash
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return NextResponse.json(
        { error: "An account with this email already exists" },
        { status: 409 },
      );
    }

    // Cost factor 12 means bcrypt runs 2^12 = 4096 iterations — slow enough to resist brute-force
    const passwordHash = await bcrypt.hash(password, 12);

    const user = await prisma.user.create({
      data: { name: name || null, email, passwordHash },
      // Never return the password hash to the client
      select: { id: true, email: true, name: true },
    });

    // Create a JWT and attach it as an httpOnly cookie on the response
    const token = await createToken({ userId: user.id, email: user.email });
    const response = NextResponse.json(user, { status: 201 });
    response.cookies.set(SESSION_COOKIE, token, cookieOptions);
    return response;
  } catch (error) {
    console.error("Registration error:", error);
    return NextResponse.json(
      { error: "Registration failed. Please try again." },
      { status: 500 },
    );
  }
}
