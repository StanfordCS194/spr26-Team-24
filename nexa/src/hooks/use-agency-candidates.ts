"use client";

import { useCallback, useRef, useState } from "react";
import type { ApiResponse } from "@/lib/api/response";
import type { AgencyCandidatesResult } from "@/lib/api/types";

export type { AgencyCandidatesResult };

export interface AgencyCandidatesLocation {
  latitude: number | null;
  longitude: number | null;
}

/**
 * Resolves the candidate agencies for an issue + location via
 * `/api/reports/agency-candidates`. When more than one agency covers the same
 * spot (an ambiguous match), the review step surfaces them and lets the user
 * pick one. Owns the `result` and its loading flag, mirroring `useFormLookup`.
 */
export function useAgencyCandidates() {
  const [result, setResult] = useState<AgencyCandidatesResult | null>(null);
  const [loading, setLoading] = useState(false);
  // True when the last lookup failed (network error or a non-OK response). The
  // review step uses this to surface a retry, distinguishing a real failure
  // from "not resolved yet" (both leave `result` null).
  const [error, setError] = useState(false);
  // The most recent lookup arguments, kept so `retry` can re-run them without
  // the caller having to thread the issue type + location back through.
  const lastRequest = useRef<{
    issueType: string;
    location: AgencyCandidatesLocation;
  } | null>(null);

  const lookup = useCallback(
    async (issueType: string, location: AgencyCandidatesLocation) => {
      lastRequest.current = { issueType, location };

      // Routing is polygon-based, so without coordinates there is nothing to
      // resolve. Clear any stale result and skip the request.
      if (
        typeof location.latitude !== "number" ||
        typeof location.longitude !== "number"
      ) {
        setResult(null);
        setError(false);
        return;
      }

      setLoading(true);
      setError(false);
      try {
        const res = await fetch("/api/reports/agency-candidates", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            issueType,
            latitude: location.latitude,
            longitude: location.longitude,
          }),
        });
        const payload =
          (await res.json()) as ApiResponse<AgencyCandidatesResult>;
        if (!res.ok || !payload.success) {
          throw new Error(
            !payload.success ? payload.error : "Agency lookup failed.",
          );
        }
        setResult(payload.data);
      } catch (err) {
        console.error("Agency candidates lookup failed:", err);
        // A failed lookup must not block submission — fall back to no
        // disambiguation (server still routes/validates on create). We flag the
        // error so the review step can offer a retry instead of silently
        // dropping the disambiguation flow.
        setResult(null);
        setError(true);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  // Re-run the last lookup. Used by the review step's error fallback so the user
  // can recover from a transient failure without restarting the flow.
  const retry = useCallback(() => {
    const last = lastRequest.current;
    if (!last) return;
    void lookup(last.issueType, last.location);
  }, [lookup]);

  const reset = useCallback(() => {
    setResult(null);
    setLoading(false);
    setError(false);
    lastRequest.current = null;
  }, []);

  return { result, loading, error, lookup, retry, reset };
}
