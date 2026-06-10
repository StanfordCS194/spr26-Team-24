"use client";

import { useCallback, useState } from "react";
import { useI18n } from "@/i18n/provider";

export type OfficialFormLookupResult =
  | {
      status: "found";
      cityName: string;
      formUrl: string;
      reason: string;
      confidence: "low" | "medium" | "high";
    }
  | {
      status: "not_found";
      cityName: string | null;
      message: string;
      reason?: string;
    };

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
        if (!res.ok) throw new Error(t("report.noOfficialForm"));
        const result: OfficialFormLookupResult = await res.json();
        setOfficialForm(result);
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
