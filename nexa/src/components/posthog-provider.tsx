"use client";

import posthog from "posthog-js";
import { PostHogProvider as PHProvider, usePostHog } from "posthog-js/react";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";

if (
  typeof window !== "undefined" &&
  process.env.NEXT_PUBLIC_POSTHOG_KEY &&
  !posthog.__loaded
) {
  posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY, {
    api_host:
      process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com",
    capture_pageview: false,
    capture_pageleave: true,
  });

  // Measurement-only tap (K2, e2e/k2-measure.spec.ts). When
  // NEXT_PUBLIC_POSTHOG_CAPTURE_DEBUG is set, wrap `capture` so every event the
  // app emits is mirrored — synchronously, before any send/batch — onto
  // window.__phEvents. The measurement spec then reads the LITERAL
  // `time_to_submit_ms` the app records, with no network/encoding to decode and
  // no dependency on the SDK's send pipeline reaching a host. The original
  // capture still runs (we delegate to it and return its result), so normal
  // ingestion is untouched. The flag is never set in production -> no-op there.
  if (process.env.NEXT_PUBLIC_POSTHOG_CAPTURE_DEBUG) {
    const originalCapture = posthog.capture.bind(posthog);
    posthog.capture = ((
      event: string,
      properties?: Record<string, unknown>,
    ) => {
      const w = window as Window & {
        __phEvents?: { event: string; properties?: Record<string, unknown> }[];
      };
      (w.__phEvents ??= []).push({ event, properties });
      return originalCapture(event, properties);
    }) as typeof posthog.capture;
  }
}

function PostHogPageview() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const ph = usePostHog();

  useEffect(() => {
    if (pathname && ph) {
      let url = window.origin + pathname;
      const search = searchParams.toString();
      if (search) url += `?${search}`;
      ph.capture("$pageview", { $current_url: url });
    }
  }, [pathname, searchParams, ph]);

  return null;
}

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  if (!process.env.NEXT_PUBLIC_POSTHOG_KEY) {
    return <>{children}</>;
  }

  return (
    <PHProvider client={posthog}>
      <Suspense fallback={null}>
        <PostHogPageview />
      </Suspense>
      {children}
    </PHProvider>
  );
}
