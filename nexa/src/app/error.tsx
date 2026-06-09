"use client"; // Error boundaries must be Client Components

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

/**
 * Route-segment error boundary. Next.js renders this as the fallback UI when an
 * unhandled error throws while rendering a page or nested layout in this
 * segment. It logs the error (so blank-screen crashes leave a trace) and offers
 * the user a way to recover via Next 16's `unstable_retry`, which re-fetches and
 * re-renders the failed segment.
 */
export default function Error({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    // Surface the error to the console / error reporting. `digest` correlates a
    // client-side message with the corresponding server-side log entry.
    console.error("Unhandled application error:", error);
  }, [error]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 py-10 text-center">
      <div className="mx-auto flex max-w-md flex-col items-center gap-4">
        <h1 className="text-2xl font-semibold">Something went wrong</h1>
        <p className="text-sm text-muted-foreground">
          An unexpected error occurred. You can try again, and if the problem
          persists, please come back in a little while.
        </p>
        {error.digest && (
          <p className="font-mono text-xs text-muted-foreground">
            Reference: {error.digest}
          </p>
        )}
        <Button onClick={() => unstable_retry()} className="mt-2">
          Try again
        </Button>
      </div>
    </main>
  );
}
