// Browser-side Web Push helpers (issue #38). Used by the opt-in hook/UI to
// register a push subscription with the active service worker and sync it to
// the server. Everything here is gated on the NEXT_PUBLIC_VAPID_PUBLIC_KEY env
// var — when it's unset push is unavailable and the UI hides itself.

import type { ApiResponse } from "@/lib/api/response";

export const VAPID_PUBLIC_KEY =
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? undefined;

/** True when the browser supports Web Push and a VAPID key is configured. */
export function isPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window &&
    Boolean(VAPID_PUBLIC_KEY)
  );
}

// The PushManager wants the application server key as a Uint8Array; VAPID keys
// are distributed as URL-safe base64. Convert here.
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const buffer = new ArrayBuffer(raw.length);
  const output = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i++) {
    output[i] = raw.charCodeAt(i);
  }
  return output;
}

async function getRegistration(): Promise<ServiceWorkerRegistration> {
  // PwaSetup registers /sw.js on load; `ready` resolves once it's active.
  return navigator.serviceWorker.ready;
}

/** Current permission state, or "unsupported" when push can't be used here. */
export function getPushPermission(): NotificationPermission | "unsupported" {
  if (!isPushSupported()) return "unsupported";
  return Notification.permission;
}

/** Whether this browser already has an active push subscription. */
export async function getExistingSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null;
  const registration = await getRegistration();
  return registration.pushManager.getSubscription();
}

/**
 * Request permission (if needed), create a push subscription, and persist it on
 * the server. Returns true once the subscription is stored. Throws if the user
 * denies permission or the browser can't subscribe.
 */
export async function subscribeToPush(): Promise<boolean> {
  if (!isPushSupported() || !VAPID_PUBLIC_KEY) {
    throw new Error("Push notifications are not available in this browser.");
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("Notification permission was not granted.");
  }

  const registration = await getRegistration();
  const existing = await registration.pushManager.getSubscription();
  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    }));

  const res = await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(subscription.toJSON()),
  });

  if (!res.ok) {
    const payload = (await res
      .json()
      .catch(() => null)) as ApiResponse<unknown> | null;
    throw new Error(
      payload && !payload.success
        ? payload.error
        : "Failed to save push subscription.",
    );
  }
  return true;
}

/**
 * Remove the active push subscription from the browser and the server.
 * Idempotent — safe to call when not subscribed.
 */
export async function unsubscribeFromPush(): Promise<void> {
  if (!isPushSupported()) return;
  const registration = await getRegistration();
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;

  const { endpoint } = subscription;
  await subscription.unsubscribe().catch(() => {});

  await fetch("/api/push/unsubscribe", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ endpoint }),
  }).catch(() => {});
}
