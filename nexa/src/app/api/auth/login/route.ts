import { NextRequest, NextResponse } from "next/server";
import { createToken, SESSION_COOKIE, cookieOptions } from "@/lib/auth";

export async function POST(request: NextRequest) {
  try {
    const { email, password } = await request.json();

    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password are required" },
        { status: 400 },
      );
    }

    const demoUser = {
      id: "demo_user",
      email,
      name: email.split("@")[0],
    };

    const token = await createToken({ userId: demoUser.id, email });
    const response = NextResponse.json(demoUser, { status: 200 });
    response.cookies.set(SESSION_COOKIE, token, cookieOptions);
    return response;
  } catch (error) {
    console.error("Login error:", error);
    return NextResponse.json(
      { error: "Login failed. Please try again." },
      { status: 500 },
    );
  }
}
