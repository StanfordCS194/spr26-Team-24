"use client";

import { useEffect, useState } from "react";
import { Bell, BellOff, Loader2 } from "lucide-react";
import {
  isPushSupported,
  getExistingSubscription,
  getPushPermission,
  subscribeToPush,
  unsubscribeFromPush,
} from "@/lib/push/client";

// Opt-in control for Web Push notifications (issue #38). Rendered on the
// dashboard. It self-hides whenever push is unavailable — no VAPID public key
// configured, an unsupported browser, or permission already denied — so the
// app looks unchanged until keys are set (ready-to-activate).
export function PushOptIn() {
  // Resolve availability after mount so SSR and the first client render match
  // (avoids a hydration mismatch); null = undecided.
  const [available, setAvailable] = useState<boolean | null>(null);
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const usable = isPushSupported() && getPushPermission() !== "denied";

    // Resolve in a microtask so setState runs from a callback rather than
    // synchronously in the effect body (no cascading-render lint warning).
    Promise.resolve()
      .then(() => (usable ? getExistingSubscription() : null))
      .then((sub) => {
        if (!active) return;
        setAvailable(usable);
        setSubscribed(Boolean(sub));
      })
      .catch(() => {
        if (active) setAvailable(usable);
      });

    return () => {
      active = false;
    };
  }, []);

  if (!available) return null;

  const onToggle = async () => {
    setBusy(true);
    setError(null);
    try {
      if (subscribed) {
        await unsubscribeFromPush();
        setSubscribed(false);
      } else {
        await subscribeToPush();
        setSubscribed(true);
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not update notification settings.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={onToggle}
        disabled={busy}
        className="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 font-mono text-xs uppercase tracking-wider text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-60"
        aria-pressed={subscribed}
      >
        {busy ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : subscribed ? (
          <BellOff className="size-3.5" />
        ) : (
          <Bell className="size-3.5" />
        )}
        {subscribed ? "Turn off notifications" : "Notify me of status updates"}
      </button>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
