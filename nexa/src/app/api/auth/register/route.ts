import { NextRequest, NextResponse } from "next/server";
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

    const demoUser = {
      id: "demo_user",
      email,
      name: name || null,
    };

    const token = await createToken({ userId: demoUser.id, email });
    const response = NextResponse.json(demoUser, { status: 201 });
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
