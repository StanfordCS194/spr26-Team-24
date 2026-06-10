import { z } from "zod";

// ---------------------------------------------------------------------------
// Google OAuth 2.0 helper (env-gated "Continue with Google").
//
// Pure, transport-injectable logic for the Authorization Code flow against
// Google. The route handlers (`/api/auth/google` and its `/callback`) own the
// cookies, redirects, and session issuance; this module only builds the consent
// URL and exchanges an authorization code for the user's verified email/name.
//
// Like the submission agents, `fetchGoogleUser` never throws — it returns a
// typed discriminated result so the callback can redirect to a friendly error.
// ---------------------------------------------------------------------------

export const GOOGLE_AUTH_ENDPOINT =
  "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
export const GOOGLE_USERINFO_ENDPOINT =
  "https://openidconnect.googleapis.com/v1/userinfo";

// openid -> we get an id; email/profile -> the address and display name.
const SCOPE = "openid email profile";

// Short-lived cookies the start route sets and the callback reads: `state` is
// the CSRF nonce; `redirect` carries the post-login destination across the
// round-trip to Google.
export const OAUTH_STATE_COOKIE = "nexa-oauth-state";
export const OAUTH_REDIRECT_COOKIE = "nexa-oauth-redirect";

/** Builds the Google consent-screen URL to redirect the user to. */
export function buildGoogleAuthUrl(params: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const url = new URL(GOOGLE_AUTH_ENDPOINT);
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPE);
  url.searchParams.set("state", params.state);
  url.searchParams.set("access_type", "online");
  // Always let the user pick which Google account to use.
  url.searchParams.set("prompt", "select_account");
  return url.toString();
}

const tokenSchema = z.object({ access_token: z.string().min(1) });

// Google may send email_verified as a boolean or the string "true".
const userInfoSchema = z.object({
  email: z.string().email(),
  email_verified: z.union([z.boolean(), z.string()]).optional(),
  name: z.string().optional(),
});

export type GoogleUser = {
  email: string;
  name: string | null;
  emailVerified: boolean;
};

export type GoogleAuthResult =
  | { status: "ok"; user: GoogleUser }
  | { status: "error"; message: string };

/**
 * Exchanges an authorization `code` for the signed-in Google user's profile.
 *
 * Never throws: every network/parse failure becomes a typed `error` result the
 * callback maps onto a `?error=` redirect. `fetchImpl` is injectable for tests.
 */
export async function fetchGoogleUser(params: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
  fetchImpl?: typeof fetch;
}): Promise<GoogleAuthResult> {
  const doFetch = params.fetchImpl ?? fetch;

  // 1. Exchange the authorization code for an access token.
  let tokenRes: Response;
  try {
    tokenRes = await doFetch(GOOGLE_TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: params.clientId,
        client_secret: params.clientSecret,
        code: params.code,
        redirect_uri: params.redirectUri,
        grant_type: "authorization_code",
      }).toString(),
    });
  } catch {
    return {
      status: "error",
      message: "Could not reach Google to exchange the code.",
    };
  }
  if (!tokenRes.ok) {
    return {
      status: "error",
      message: "Google rejected the authorization code.",
    };
  }
  const tokenJson = await tokenRes.json().catch(() => null);
  const token = tokenSchema.safeParse(tokenJson);
  if (!token.success) {
    return { status: "error", message: "Google returned no access token." };
  }

  // 2. Read the user's profile with the access token.
  let infoRes: Response;
  try {
    infoRes = await doFetch(GOOGLE_USERINFO_ENDPOINT, {
      headers: { Authorization: `Bearer ${token.data.access_token}` },
    });
  } catch {
    return {
      status: "error",
      message: "Could not reach Google to read your profile.",
    };
  }
  if (!infoRes.ok) {
    return { status: "error", message: "Google rejected the profile request." };
  }
  const infoJson = await infoRes.json().catch(() => null);
  const info = userInfoSchema.safeParse(infoJson);
  if (!info.success) {
    return {
      status: "error",
      message: "Google returned an unexpected profile.",
    };
  }

  const emailVerified =
    info.data.email_verified === true || info.data.email_verified === "true";
  return {
    status: "ok",
    user: {
      email: info.data.email.toLowerCase(),
      name: info.data.name ?? null,
      emailVerified,
    },
  };
}
