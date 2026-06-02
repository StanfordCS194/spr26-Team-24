"use client";

import { useEffect } from "react";
import { flushQueue } from "@/lib/offline-queue";

// Registers the service worker and replays any reports queued while offline.
// Rendered once from the root layout. Returns no UI.
export function PwaSetup() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Registration failures are non-fatal — the app still works online.
      });
    }

    void flushQueue();
    const onOnline = () => void flushQueue();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, []);

  return null;
}
