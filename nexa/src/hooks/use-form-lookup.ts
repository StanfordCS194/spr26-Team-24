"use client";

import { useCallback, useState } from "react";
import { useI18n } from "@/i18n/provider";
import type { ApiResponse } from "@/lib/api/response";
import type { OfficialFormLookupResult } from "@/lib/api/types";

export type { OfficialFormLookupResult };

export interface FormLookupLocation {
  address: string;
  latitude: number | null;
  longitude: number | null;
}

/**
 * Looks up the official municipal reporting form for an issue + location via
 * `/api/reports/form-link`. Extracted from the report page; owns the
 * `officialForm` result and its loading flag.
 */
export function useFormLookup() {
  const { t } = useI18n();
  const [officialForm, setOfficialForm] =
    useState<OfficialFormLookupResult | null>(null);
  const [loading, setLoading] = useState(false);

  const lookup = useCallback(
    async (issueType: string, location: FormLookupLocation) => {
      const hasLocation =
        !!location.address.trim() ||
        (typeof location.latitude === "number" &&
          typeof location.longitude === "number");

      if (!hasLocation) {
        setOfficialForm({
          status: "not_found",
          cityName: null,
          message: t("report.noOfficialForm"),
          reason: t("report.locationPlaceholder"),
        });
        return;
      }

      setLoading(true);
      try {
        const res = await fetch("/api/reports/form-link", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            issueType,
            address: location.address || undefined,
            latitude: location.latitude ?? undefined,
            longitude: location.longitude ?? undefined,
          }),
        });
        const payload =
          (await res.json()) as ApiResponse<OfficialFormLookupResult>;
        if (!res.ok || !payload.success) {
          throw new Error(
            !payload.success ? payload.error : t("report.noOfficialForm"),
          );
        }
        setOfficialForm(payload.data);
      } catch (err) {
        console.error("Official form lookup failed:", err);
        setOfficialForm({
          status: "not_found",
          cityName: null,
          message: t("report.noOfficialForm"),
          reason:
            err instanceof Error ? err.message : t("report.noOfficialForm"),
        });
      } finally {
        setLoading(false);
      }
    },
    [t],
  );

  const reset = useCallback(() => {
    setOfficialForm(null);
    setLoading(false);
  }, []);

  return { officialForm, loading, lookup, setOfficialForm, reset };
}
