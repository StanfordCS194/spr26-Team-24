// GET /api/auth/google/callback
// Finishes the OAuth flow: verifies the CSRF `state`, exchanges the code for the
// user's verified Google email, upserts the account (no password — Google-only
// accounts have a null passwordHash), issues the same JWT session as password
// login, and redirects to where the user started. Every failure path redirects
// to /login?error=… and clears the short-lived OAuth cookies.

import { NextRequest, NextResponse } from "next/server";
import {
  getGoogleOAuthClientId,
  getGoogleOAuthClientSecret,
} from "@/lib/config";
import {
  fetchGoogleUser,
  OAUTH_STATE_COOKIE,
  OAUTH_REDIRECT_COOKIE,
} from "@/lib/google-oauth";
import { prisma } from "@/lib/prisma";
import { createToken, SESSION_COOKIE, cookieOptions } from "@/lib/auth";
import { safeRedirect } from "@/lib/utils";

/** Redirect to /login with an error code, clearing the in-flight OAuth cookies. */
function loginError(request: NextRequest, code: string) {
  const response = NextResponse.redirect(
    new URL(`/login?error=${code}`, request.url),
  );
  response.cookies.set(OAUTH_STATE_COOKIE, "", { maxAge: 0, path: "/" });
  response.cookies.set(OAUTH_REDIRECT_COOKIE, "", { maxAge: 0, path: "/" });
  return response;
}

export async function GET(request: NextRequest) {
  const clientId = getGoogleOAuthClientId();
  const clientSecret = getGoogleOAuthClientSecret();
  if (!clientId || !clientSecret) {
    return loginError(request, "google_unavailable");
  }

  const url = new URL(request.url);

  // The user denied consent (or Google reported an error).
  if (url.searchParams.get("error")) {
    return loginError(request, "google_denied");
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieState = request.cookies.get(OAUTH_STATE_COOKIE)?.value;
  // CSRF: the state echoed back by Google must match the one we set as a cookie.
  if (!code || !state || !cookieState || state !== cookieState) {
    return loginError(request, "google_state");
  }

  const callbackUrl = new URL(
    "/api/auth/google/callback",
    url.origin,
  ).toString();
  const result = await fetchGoogleUser({
    clientId,
    clientSecret,
    code,
    redirectUri: callbackUrl,
  });
  if (result.status !== "ok") {
    return loginError(request, "google_failed");
  }
  if (!result.user.emailVerified) {
    return loginError(request, "google_unverified");
  }

  // Match (or create) the account by email. passwordHash stays null for
  // Google-only accounts; an existing password account simply gains Google as
  // another way in. We never clobber an existing display name.
  const user = await prisma.user.upsert({
    where: { email: result.user.email },
    update: {},
    create: { email: result.user.email, name: result.user.name },
    select: { id: true, email: true },
  });

  const token = await createToken({ userId: user.id, email: user.email });
  const redirectTo = safeRedirect(
    request.cookies.get(OAUTH_REDIRECT_COOKIE)?.value,
  );

  const response = NextResponse.redirect(new URL(redirectTo, request.url));
  response.cookies.set(SESSION_COOKIE, token, cookieOptions);
  response.cookies.set(OAUTH_STATE_COOKIE, "", { maxAge: 0, path: "/" });
  response.cookies.set(OAUTH_REDIRECT_COOKIE, "", { maxAge: 0, path: "/" });
  return response;
}
