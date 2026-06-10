"use client";

import { useCallback, useState } from "react";

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

interface FormLookupLocation {
  address: string;
  latitude: number | null;
  longitude: number | null;
}

interface FormLookupMessages {
  /** Shown when there is no official form / lookup fails (`report.noOfficialForm`). */
  noOfficialForm: string;
  /** Shown as the reason when no location is available (`report.locationPlaceholder`). */
  noLocation: string;
}

/**
 * Resolves the official municipal form link for a classified issue via
 * `/api/reports/form-link`. Owns the resolved result and its loading flag.
 */
export function useFormLookup() {
  const [officialForm, setOfficialForm] =
    useState<OfficialFormLookupResult | null>(null);
  const [loading, setLoading] = useState(false);

  const lookup = useCallback(
    async (
      issueType: string,
      location: FormLookupLocation,
      messages: FormLookupMessages,
    ) => {
      const hasLocation =
        !!location.address.trim() ||
        (typeof location.latitude === "number" &&
          typeof location.longitude === "number");

      if (!hasLocation) {
        setOfficialForm({
          status: "not_found",
          cityName: null,
          message: messages.noOfficialForm,
          reason: messages.noLocation,
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
        if (!res.ok) throw new Error(messages.noOfficialForm);
        const result: OfficialFormLookupResult = await res.json();
        setOfficialForm(result);
      } catch (err) {
        setOfficialForm({
          status: "not_found",
          cityName: null,
          message: messages.noOfficialForm,
          reason: err instanceof Error ? err.message : messages.noOfficialForm,
        });
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const reset = useCallback(() => {
    setOfficialForm(null);
    setLoading(false);
  }, []);

  return { officialForm, loading, lookup, setOfficialForm, setLoading, reset };
}
