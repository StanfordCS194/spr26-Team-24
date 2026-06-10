import webpush from "web-push";
import { prisma } from "@/lib/prisma";

// Web Push notifications (issue #38). Complementary to the email path in
// `@/lib/email` — never a replacement. The whole feature is ENV-GATED on a
// VAPID key pair so the app runs unchanged when keys are absent:
//
//   VAPID_PUBLIC_KEY   — the public application server key (also exposed to the
//                        client as NEXT_PUBLIC_VAPID_PUBLIC_KEY for subscribe())
//   VAPID_PRIVATE_KEY  — the private application server key (server only)
//   VAPID_SUBJECT      — a mailto: or https: contact URL (optional; defaults
//                        below). Required by the Web Push spec for the JWT.
//
// Generate a pair with: `npx web-push generate-vapid-keys`
//
// When the keys are unset, `sendPush` is a NO-OP: it logs once and returns, so
// nothing throws and no push traffic is attempted (ready-to-activate).

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT ?? "mailto:noreply@nexa.app";

/** True only when a usable VAPID key pair is configured. */
export function isPushConfigured(): boolean {
  return Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);
}

// Configure web-push lazily so importing this module never throws on a missing
// key. `details` is only set once, the first time we actually need to send.
let vapidConfigured = false;
function ensureVapid(): boolean {
  if (!isPushConfigured()) return false;
  if (!vapidConfigured) {
    webpush.setVapidDetails(
      VAPID_SUBJECT,
      VAPID_PUBLIC_KEY as string,
      VAPID_PRIVATE_KEY as string,
    );
    vapidConfigured = true;
  }
  return true;
}

export interface PushPayload {
  title: string;
  body: string;
  // Where to send the user when they click the notification.
  url?: string;
  tag?: string;
}

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/**
 * Send a single push notification to one subscription.
 *
 * NO-OP when VAPID keys are unset: logs once and returns `false` without
 * touching the network. Returns `true` on a successful send. On a `410 Gone`
 * (or `404`) the subscription is dead, so we prune it from the database and
 * return `false`.
 */
export async function sendPushToSubscription(
  target: PushTarget,
  payload: PushPayload,
): Promise<boolean> {
  if (!ensureVapid()) {
    console.warn("[push] VAPID keys not set — skipping push send");
    return false;
  }

  try {
    await webpush.sendNotification(
      {
        endpoint: target.endpoint,
        keys: { p256dh: target.p256dh, auth: target.auth },
      },
      JSON.stringify(payload),
    );
    return true;
  } catch (error) {
    const statusCode =
      error && typeof error === "object" && "statusCode" in error
        ? (error as { statusCode?: number }).statusCode
        : undefined;

    // 404/410 mean the push service has dropped this subscription for good.
    // Remove it so we stop trying and the table doesn't fill with dead rows.
    if (statusCode === 404 || statusCode === 410) {
      await prisma.pushSubscription
        .deleteMany({ where: { endpoint: target.endpoint } })
        .catch(() => {});
      return false;
    }

    console.error("[push] send failed", { endpoint: target.endpoint, error });
    return false;
  }
}

/**
 * Send a push notification to every subscription a user has (one per device).
 *
 * NO-OP when VAPID keys are unset (logs once, returns 0) or when `userId` is
 * null/empty. Returns the number of subscriptions successfully delivered to.
 */
export async function sendPush(
  userId: string | null | undefined,
  payload: PushPayload,
): Promise<number> {
  if (!isPushConfigured()) {
    console.warn("[push] VAPID keys not set — skipping push send");
    return 0;
  }
  if (!userId) return 0;

  const subscriptions = await prisma.pushSubscription.findMany({
    where: { userId },
    select: { endpoint: true, p256dh: true, auth: true },
  });

  if (subscriptions.length === 0) return 0;

  const results = await Promise.all(
    subscriptions.map((sub) => sendPushToSubscription(sub, payload)),
  );
  return results.filter(Boolean).length;
}
