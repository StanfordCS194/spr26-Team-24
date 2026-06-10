"use client";

import { useCallback, useState } from "react";
import dynamic from "next/dynamic";
import { MapPinned } from "lucide-react";
import type { IssueMapPoint } from "@/components/map/community-map";
import type { ApiResponse } from "@/lib/api/response";
import { useI18n } from "@/i18n/provider";

// Leaflet touches `window`/`document`, so render the map only on the client.
const CommunityMap = dynamic(() => import("@/components/map/community-map"), {
  ssr: false,
  loading: () => (
    <div className="h-[calc(100vh-72px)] w-full animate-pulse bg-muted/40" />
  ),
});

interface CommunityMapPanelProps {
  initialPoints: IssueMapPoint[];
}

/**
 * Client wrapper that owns the issue-map data: seeds from the server render,
 * refetches after a resolution so every viewer's pin colour stays in sync, and
 * renders the Leaflet map plus an empty state.
 */
export default function CommunityMapPanel({
  initialPoints,
}: CommunityMapPanelProps) {
  const { t } = useI18n();
  const [points, setPoints] = useState<IssueMapPoint[]>(initialPoints);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    const response = await fetch("/api/issues/map");
    if (!response.ok) return;
    const payload = (await response.json()) as ApiResponse<{
      points: IssueMapPoint[];
    }>;
    if (payload.success) setPoints(payload.data.points);
  }, []);

  const handleResolve = useCallback(
    async (reportId: string) => {
      setError(null);
      const response = await fetch(`/api/reports/${reportId}/resolution`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resolved: true }),
      });
      if (!response.ok) {
        const payload = (await response
          .json()
          .catch(() => null)) as ApiResponse<unknown> | null;
        setError(
          payload && !payload.success ? payload.error : t("map.resolveFailed"),
        );
        throw new Error("resolve-failed");
      }
      await refetch();
    },
    [refetch, t],
  );

  if (points.length === 0) {
    return (
      <div className="flex h-[calc(100vh-72px)] w-full flex-col items-center justify-center gap-3 px-6 text-center">
        <MapPinned
          className="size-8 text-muted-foreground"
          aria-hidden="true"
        />
        <p className="text-lg">No community issues yet.</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          Reported issues with a location will appear here as pins, grouped so
          duplicates from different people share one case.
        </p>
      </div>
    );
  }

  return (
    <div className="relative">
      {error && (
        <div
          role="alert"
          className="absolute left-1/2 top-4 z-[1000] -translate-x-1/2 rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700 shadow-sm"
        >
          {error}
        </div>
      )}
      <CommunityMap points={points} onResolve={handleResolve} />
    </div>
  );
}
