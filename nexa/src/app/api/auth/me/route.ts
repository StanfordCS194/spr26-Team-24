// GET /api/auth/me
// Returns the currently logged-in user's public profile, or 401 if there is no valid session.
// The Navbar and other client components call this to know if the user is logged in.

import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  // getSession reads the httpOnly cookie and verifies the JWT — server-side only
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { id: true, email: true, name: true },
  });

  if (!user) {
    // The user was deleted after their token was issued
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  return NextResponse.json(user);
}
