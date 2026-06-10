import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { createToken, SESSION_COOKIE, cookieOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { LoginSchema } from "@/lib/api/schemas";
import {
  parseJsonRequest,
  RequestParseError,
  parseErrorResponse,
} from "@/lib/api/request-parser";

export async function POST(request: NextRequest) {
  try {
    const { email, password } = await parseJsonRequest(request, LoginSchema);

    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password are required" },
        { status: 400 },
      );
    }

    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, name: true, passwordHash: true },
    });

    // Use the same generic message for "no user" and "wrong password" so the
    // login endpoint cannot be used to enumerate which emails have accounts.
    if (!user || !user.passwordHash) {
      return NextResponse.json(
        { error: "Invalid email or password" },
        { status: 401 },
      );
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      return NextResponse.json(
        { error: "Invalid email or password" },
        { status: 401 },
      );
    }

    const token = await createToken({ userId: user.id, email: user.email });
    const response = NextResponse.json(
      { id: user.id, email: user.email, name: user.name },
      { status: 200 },
    );
    response.cookies.set(SESSION_COOKIE, token, cookieOptions);
    return response;
  } catch (error) {
    if (error instanceof RequestParseError) {
      return parseErrorResponse(error);
    }
    console.error("Login error:", error);
    return NextResponse.json(
      { error: "Login failed. Please try again." },
      { status: 500 },
    );
  }
}
