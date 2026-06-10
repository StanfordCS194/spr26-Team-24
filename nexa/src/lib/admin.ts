import { getAdminEmails } from "@/lib/config";
import { getSession, type SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// Admin authorization (issue #219).
//
// The admin analytics dashboard at /admin exposes aggregate data across ALL
// reports, so access is restricted to an explicit allowlist of email addresses
// (the `ADMIN_EMAILS` env var, see src/lib/config.ts). The check is enforced in
// two server-side places that a non-admin cannot bypass:
//   1. the proxy (src/proxy.ts) — a coarse gate that 404s/redirects before the
//      page renders, so the admin route is invisible to non-admins; and
//   2. the page itself (src/app/admin/page.tsx) via `requireAdmin` — the
//      authoritative gate, so even if the proxy matcher ever changed the data
//      query never runs for a non-admin.
//
// The allowlist is empty by default (no `ADMIN_EMAILS` set => nobody is an
// admin), so the dashboard is closed unless an operator opts a specific address
// in. We never trust a client-supplied flag to decide admin status.
// ---------------------------------------------------------------------------

/**
 * Whether `email` is on the admin allowlist. Case-insensitive (the allowlist is
 * normalized to lower-case in {@link getAdminEmails}). A nullish/empty email is
 * never an admin.
 */
export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return getAdminEmails().has(email.trim().toLowerCase());
}

/**
 * Whether the given session belongs to an admin. A missing session is never an
 * admin.
 */
export function isAdminSession(session: SessionPayload | null): boolean {
  return isAdminEmail(session?.email);
}

/**
 * Read the current session and return it only if it belongs to an admin;
 * otherwise return `null`. Server-side use only (reads the session cookie).
 * Callers should treat a `null` result as "not authorized" and respond with a
 * redirect / 403 / 404 — never render admin data.
 */
export async function requireAdmin(): Promise<SessionPayload | null> {
  const session = await getSession();
  return isAdminSession(session) ? session : null;
}
