import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { createToken, SESSION_COOKIE, cookieOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { successResponse, errorResponse } from "@/lib/api/response";

// One-shot path to set a password on accounts that never had one. This exists
// to clean up after a prior bug in /api/auth/login that upserted users by
// email without ever asking for or verifying a password — see README / PR.
//
// Only succeeds if the account currently has `passwordHash = null`. Once a
// password is set, this endpoint becomes a no-op for that user.
export async function POST(request: NextRequest) {
  try {
    const { email, password, name } = await request.json();

    if (!email || !password) {
      return errorResponse("Email and password are required", 400);
    }

    if (typeof password !== "string" || password.length < 8) {
      return errorResponse("Password must be at least 8 characters", 400);
    }

    const existing = await prisma.user.findUnique({
      where: { email },
      select: { id: true, passwordHash: true },
    });

    if (existing && existing.passwordHash) {
      return errorResponse(
        "This account already has a password. Sign in instead, or reset your password.",
        409,
      );
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const user = existing
      ? await prisma.user.update({
          where: { id: existing.id },
          data: { passwordHash, ...(name ? { name } : {}) },
          select: { id: true, email: true, name: true },
        })
      : await prisma.user.create({
          data: { email, name: name ?? null, passwordHash },
          select: { id: true, email: true, name: true },
        });

    const token = await createToken({ userId: user.id, email: user.email });
    const response = successResponse(user);
    response.cookies.set(SESSION_COOKIE, token, cookieOptions);
    return response;
  } catch (error) {
    console.error("Account claim error:", error);
    return errorResponse("Failed to set password. Please try again.", 500);
  }
}
