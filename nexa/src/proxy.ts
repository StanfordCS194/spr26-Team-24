// Next.js proxy runs before the request hits any route handler or page.
// We use it to protect routes: redirect unauthenticated users to /login,
// and redirect already-logged-in users away from /login and /register.

import { NextRequest, NextResponse } from "next/server";
import { verifyToken, SESSION_COOKIE } from "@/lib/auth";

// Pages that require a logged-in user — any path that starts with these strings is protected
const PROTECTED_ROUTES = ["/report", "/dashboard"];

// Pages that logged-in users should not see (they're already authenticated)
const AUTH_ROUTES = ["/login", "/register"];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Read the session JWT from the cookie — the browser sends it automatically on every request
  const token = request.cookies.get(SESSION_COOKIE)?.value;

  // verifyToken checks the signature and expiry without hitting the database
  const session = token ? await verifyToken(token) : null;

  const isProtected = PROTECTED_ROUTES.some((r) => pathname.startsWith(r));
  const isAuthRoute = AUTH_ROUTES.some((r) => pathname.startsWith(r));

  if (isProtected && !session) {
    // Save the intended destination so we can redirect back after login
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (isAuthRoute && session) {
    // Already logged in — send them to the home page instead of showing the login form
    return NextResponse.redirect(new URL("/", request.url));
  }

  return NextResponse.next();
}

export const config = {
  // Run on every path except Next.js internals and static assets
  matcher: ["/((?!_next/static|_next/image|favicon.ico|public).*)"],
};
