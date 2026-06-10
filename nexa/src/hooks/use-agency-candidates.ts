"use client";

import { useCallback, useState } from "react";
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

  const lookup = useCallback(
    async (issueType: string, location: AgencyCandidatesLocation) => {
      // Routing is polygon-based, so without coordinates there is nothing to
      // resolve. Clear any stale result and skip the request.
      if (
        typeof location.latitude !== "number" ||
        typeof location.longitude !== "number"
      ) {
        setResult(null);
        return;
      }

      setLoading(true);
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
        // disambiguation (server still routes/validates on create).
        setResult(null);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const reset = useCallback(() => {
    setResult(null);
    setLoading(false);
  }, []);

  return { result, loading, lookup, reset };
}
