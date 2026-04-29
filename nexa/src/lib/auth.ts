import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

// The name of the cookie that holds the session token
export const SESSION_COOKIE = "nexa-session";

// 7 days in seconds — how long a session stays valid
const EXPIRES_IN = 7 * 24 * 60 * 60;

// What we embed inside each JWT — the minimal info needed to identify a user
export interface SessionPayload {
  userId: string;
  email: string;
}

// Encode the secret once — jose requires a Uint8Array
function getSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET environment variable is not set");
  return new TextEncoder().encode(secret);
}

// Signs a JWT containing the user's id and email, valid for 7 days
export async function createToken(payload: SessionPayload): Promise<string> {
  return new SignJWT(payload as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(getSecret());
}

// Verifies the token's signature and expiry — returns the payload or null if invalid
export async function verifyToken(
  token: string,
): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    return payload as unknown as SessionPayload;
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
