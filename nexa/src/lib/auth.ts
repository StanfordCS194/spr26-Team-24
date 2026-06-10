import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { z } from "zod";
import { getJwtSecret } from "@/lib/config";

// The name of the cookie that holds the session token
export const SESSION_COOKIE = "nexa-session";

// 7 days in seconds — how long a session stays valid
const EXPIRES_IN = 7 * 24 * 60 * 60;

// What we embed inside each JWT — the minimal info needed to identify a user
export interface SessionPayload {
  userId: string;
  email: string;
}

// Runtime shape of the claims we trust out of a decoded JWT. jose validates the
// signature/expiry, but the payload itself is attacker-influenced data, so we
// validate the fields we read before handing them to callers. The schema is
// non-strict so the standard JWT registered claims (iat/exp/...) jose adds pass
// through; we then return just the SessionPayload fields callers depend on.
const sessionPayloadSchema = z.object({
  userId: z.string().min(1),
  email: z.string().min(1),
});

// Encode the secret once — jose requires a Uint8Array.
// getJwtSecret() throws a clear, named error when JWT_SECRET is unset.
function getSecret() {
  return new TextEncoder().encode(getJwtSecret());
}

// Signs a JWT containing the user's id and email, valid for 7 days.
// SignJWT accepts a JWTPayload directly — SessionPayload satisfies it, so no cast.
export async function createToken(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(getSecret());
}

// Verifies the token's signature and expiry, then validates the decoded claims.
// Returns the typed payload, or null if the signature/expiry is invalid OR the
// payload is malformed (missing/empty userId or email) — never an unchecked cast.
export async function verifyToken(
  token: string,
): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    const result = sessionPayloadSchema.safeParse(payload);
    if (!result.success) {
      // Signature was valid but the claims are not a usable session — e.g. a
      // token minted elsewhere with a different shape. Treat as logged out.
      return null;
    }
    const { userId, email } = result.data;
    return { userId, email };
  } catch {
    // Token is expired, tampered with, or the secret changed — treat as logged out
    return null;
  }
}

// Reads the session cookie and decodes it — only call this in Server Components or API routes
export async function getSession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifyToken(token);
}

// Cookie settings applied when setting or clearing the session cookie
export const cookieOptions = {
  // httpOnly prevents JavaScript from reading the cookie, protecting against XSS
  httpOnly: true,
  path: "/",
  maxAge: EXPIRES_IN,
  // lax allows the cookie to be sent on top-level navigations (e.g. clicking a link)
  sameSite: "lax" as const,
  // only send over HTTPS in production
  secure: process.env.NODE_ENV === "production",
};
