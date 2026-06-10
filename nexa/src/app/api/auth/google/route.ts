// GET /api/auth/google
// Starts the "Continue with Google" OAuth flow: mints a CSRF `state`, remembers
// where to land afterwards, and redirects to Google's consent screen. Env-gated
// — without GOOGLE_OAUTH_CLIENT_ID it bounces back to /login.

import { NextRequest, NextResponse } from "next/server";
import { getGoogleOAuthClientId } from "@/lib/config";
import {
  buildGoogleAuthUrl,
  OAUTH_STATE_COOKIE,
  OAUTH_REDIRECT_COOKIE,
} from "@/lib/google-oauth";
import { safeRedirect } from "@/lib/utils";

export async function GET(request: NextRequest) {
  const clientId = getGoogleOAuthClientId();
  if (!clientId) {
    return NextResponse.redirect(
      new URL("/login?error=google_unavailable", request.url),
    );
  }

  const url = new URL(request.url);
  const redirectTo = safeRedirect(url.searchParams.get("redirect"));
  const state = crypto.randomUUID();
  const callbackUrl = new URL(
    "/api/auth/google/callback",
    url.origin,
  ).toString();
  const authUrl = buildGoogleAuthUrl({
    clientId,
    redirectUri: callbackUrl,
    state,
  });

  const response = NextResponse.redirect(authUrl);
  const cookieBase = {
    httpOnly: true,
    path: "/",
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    maxAge: 600, // 10 minutes — long enough to complete the consent screen.
  };
  response.cookies.set(OAUTH_STATE_COOKIE, state, cookieBase);
  response.cookies.set(OAUTH_REDIRECT_COOKIE, redirectTo, cookieBase);
  return response;
}
