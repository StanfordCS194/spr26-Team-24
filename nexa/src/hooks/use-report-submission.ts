"use client";

import { useCallback, useState } from "react";
import { queueReport } from "@/lib/offline-queue";

export interface ClassificationResult {
  issueType: string;
  aiDescription: string;
  severity: "low" | "medium" | "high";
  confidence?: number;
}

export interface ProviderResult extends ClassificationResult {
  provider: string;
  latencyMs: number;
}

export interface ComparisonResponse {
  winner: ClassificationResult;
  allResults: ProviderResult[];
  consensus: boolean;
  method: string;
}

export interface CreatedReport {
  id: string;
  issueType: string | null;
  description: string | null;
  aiDescription: string | null;
  createdAt: string;
}

export interface ClassifyInput {
  description: string;
  imageBase64: string | null;
  latitude: number | null;
  longitude: number | null;
  address: string;
}

export interface SubmitInput {
  description: string;
  classification: ClassificationResult;
  latitude: number | null;
  longitude: number | null;
  address: string;
  imageBase64: string | null;
}

export interface ClassifyCallbacks {
  /** Called with the winning result so the page can sync derived state. */
  onSuccess: (data: ComparisonResponse) => void;
  /** Localized fallback message when the error is not an `Error` instance. */
  errorFallback: string;
}

export interface SubmitCallbacks {
  onSuccess: (report: CreatedReport) => void;
  onQueuedOffline: (report: CreatedReport) => void;
  /**
   * Fallback for the `/api/reports` `!res.ok` branch — used when the server
   * response omits an `error`. Distinct from {@link offlineElseFallback}.
   */
  okFallback: string;
  /**
   * Fallback for the catch's offline-ELSE branch (online failure) — distinct
   * from {@link okFallback}; the two are intentionally NOT merged.
   */
  offlineElseFallback: string;
}

/**
 * Owns the classify + submit API orchestration for the report flow:
 * fetch/parse/error handling and the loading/result/error state. Extracted
 * from the report page so the component stays a thin consumer.
 */
export function useReportSubmission() {
  const [classifying, setClassifying] = useState(false);
  const [classification, setClassification] =
    useState<ClassificationResult | null>(null);
  const [comparison, setComparison] = useState<ComparisonResponse | null>(null);
  const [classifyError, setClassifyError] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [createdReport, setCreatedReport] = useState<CreatedReport | null>(
    null,
  );
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submittedOffline, setSubmittedOffline] = useState(false);

  const classify = useCallback(
    async (input: ClassifyInput, callbacks: ClassifyCallbacks) => {
      setClassifying(true);
      setClassifyError(null);
      try {
        const res = await fetch("/api/reports/classify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            description: input.description,
            imageBase64: input.imageBase64,
            latitude: input.latitude ?? undefined,
            longitude: input.longitude ?? undefined,
            address: input.address || undefined,
          }),
        });

        // Read the raw body once so non-JSON responses surface a useful error
        // instead of Safari's cryptic "did not match the expected pattern".
        const rawBody = await res.text();
        let payload: unknown = null;
        try {
          payload = rawBody ? JSON.parse(rawBody) : null;
        } catch {
          throw new Error(
            `Classification failed (HTTP ${res.status}). Server returned a non-JSON response.`,
          );
        }

        if (!res.ok) {
          const message =
            (payload as { error?: string } | null)?.error ??
            `Classification failed (HTTP ${res.status}).`;
          throw new Error(message);
        }

        const data = payload as ComparisonResponse;
        setComparison(data);
        setClassification(data.winner);
        callbacks.onSuccess(data);
      } catch (e) {
        console.error("Report classification failed:", e);
        setClassifyError(
          e instanceof Error ? e.message : callbacks.errorFallback,
        );
      } finally {
        setClassifying(false);
      }
    },
    [],
  );

  const submit = useCallback(
    async (input: SubmitInput, callbacks: SubmitCallbacks) => {
      setSubmitting(true);
      setSubmitError(null);

      const payload = {
        description: input.description,
        aiDescription: input.classification.aiDescription,
        issueType: input.classification.issueType,
        latitude: input.latitude,
        longitude: input.longitude,
        address: input.address,
        imageUrl: input.imageBase64,
      };

      try {
        const res = await fetch("/api/reports", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || callbacks.okFallback);
        }

        const report: CreatedReport = await res.json();
        setCreatedReport(report);
        setSubmittedOffline(false);
        callbacks.onSuccess(report);
      } catch (e) {
        console.error("Report submission failed:", e);
        // No connectivity: park the report locally and confirm optimistically.
        // PwaSetup replays the queue once the browser is back online.
        if (typeof navigator !== "undefined" && !navigator.onLine) {
          queueReport(payload);
          const queued: CreatedReport = {
            id: "Pending sync",
            issueType: input.classification.issueType,
            description: input.description,
            aiDescription: input.classification.aiDescription,
            createdAt: new Date().toISOString(),
          };
          setCreatedReport(queued);
          setSubmittedOffline(true);
          callbacks.onQueuedOffline(queued);
        } else {
          setSubmitError(
            e instanceof Error ? e.message : callbacks.offlineElseFallback,
          );
        }
      } finally {
        setSubmitting(false);
      }
    },
    [],
  );

  const reset = useCallback(() => {
    setClassification(null);
    setComparison(null);
    setCreatedReport(null);
    setClassifyError(null);
    setSubmitError(null);
    setSubmittedOffline(false);
  }, []);

  return {
    classifying,
    classification,
    comparison,
    classifyError,
    submitting,
    createdReport,
    submitError,
    submittedOffline,
    classify,
    submit,
    reset,
  };
}
