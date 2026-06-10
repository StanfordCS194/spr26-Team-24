// Next.js proxy runs before the request hits any route handler or page.
// We use it to protect routes: redirect unauthenticated users to /login,
// and redirect already-logged-in users away from /login and /register.

import { NextRequest, NextResponse } from "next/server";
import { verifyToken, SESSION_COOKIE } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin";

// Pages that require a logged-in user — any path that starts with these strings is protected.
// `/report` is intentionally NOT here: anonymous (guest) reporting is allowed so a
// first-time visitor can file a report without an account. `/dashboard` stays protected
// because viewing report history still requires a signed-in user. `/admin` is protected
// too (you must be logged in) AND additionally gated to the admin allowlist below.
const PROTECTED_ROUTES = ["/dashboard", "/admin"];

// Pages restricted to admins (the `ADMIN_EMAILS` allowlist). These are a strict
// subset of PROTECTED_ROUTES, so an unauthenticated user is first bounced to
// /login above; a logged-in non-admin is then bounced to the home page here.
// This is a coarse first gate — the /admin page re-checks server-side so the
// data query never runs for a non-admin even if this matcher changes.
const ADMIN_ROUTES = ["/admin"];

// Pages that logged-in users should not see (they're already authenticated)
const AUTH_ROUTES = ["/login", "/register"];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Read the session JWT from the cookie — the browser sends it automatically on every request
  const token = request.cookies.get(SESSION_COOKIE)?.value;

  // verifyToken checks the signature and expiry without hitting the database
  const session = token ? await verifyToken(token) : null;

  const isProtected = PROTECTED_ROUTES.some((r) => pathname.startsWith(r));
  const isAdminRoute = ADMIN_ROUTES.some((r) => pathname.startsWith(r));
  const isAuthRoute = AUTH_ROUTES.some((r) => pathname.startsWith(r));

  if (isProtected && !session) {
    // Save the intended destination so we can redirect back after login
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (isAdminRoute && !isAdminEmail(session?.email)) {
    // Logged in (the check above guaranteed a session) but not on the admin
    // allowlist — never reveal the admin route exists; send them home.
    return NextResponse.redirect(new URL("/", request.url));
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
