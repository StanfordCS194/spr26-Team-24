"use client";

import { useCallback, useRef, useState } from "react";
import type { ApiResponse } from "@/lib/api/response";
import type { LinkCheckResult } from "@/lib/api/types";

export type { LinkCheckResult };

/**
 * Verifies a user-supplied custom agency link against `/api/reports/check-link`
 * and exposes the verdict for the review step's inline feedback. Mirrors
 * `useFormLookup`: owns the `result` + a `loading` flag, and is purely advisory
 * (the caller never blocks submit on it).
 *
 * `check` is debounced internally so typing/pasting into the field doesn't fire
 * a request per keystroke. A blank/whitespace URL clears the verdict instead of
 * calling the API. Each call supersedes any in-flight one, so a stale response
 * can never overwrite a newer verdict.
 */
const DEBOUNCE_MS = 500;

export function useLinkCheck() {
  const [result, setResult] = useState<LinkCheckResult | null>(null);
  const [loading, setLoading] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Monotonic token: only the latest request is allowed to write state.
  const requestIdRef = useRef(0);

  const run = useCallback(async (url: string) => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    try {
      const res = await fetch("/api/reports/check-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const payload = (await res.json()) as ApiResponse<LinkCheckResult>;

      // A superseding call started after this one — drop the stale result.
      if (requestId !== requestIdRef.current) return;

      if (!res.ok || !payload.success) {
        // A 400 means the URL is syntactically invalid; surface that verdict so
        // the user gets the same "doesn't work" feedback as a network failure,
        // rather than a silent no-op.
        setResult(
          res.status === 400
            ? { status: "invalid_url" }
            : { status: "unreachable", reason: "We couldn't check that link." },
        );
        return;
      }
      setResult(payload.data);
    } catch {
      if (requestId !== requestIdRef.current) return;
      setResult({
        status: "unreachable",
        reason: "We couldn't check that link.",
      });
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, []);

  const check = useCallback(
    (url: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);

      const trimmed = url.trim();
      if (!trimmed) {
        // Blank field: cancel any pending verdict and clear the current one.
        requestIdRef.current++;
        setResult(null);
        setLoading(false);
        return;
      }

      debounceRef.current = setTimeout(() => {
        void run(trimmed);
      }, DEBOUNCE_MS);
    },
    [run],
  );

  const reset = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    requestIdRef.current++;
    setResult(null);
    setLoading(false);
  }, []);

  return { result, loading, check, reset };
}
