"use client";

import { useCallback, useState } from "react";
import { queueReport } from "@/lib/offline-queue";

interface ClassificationResult {
  issueType: string;
  aiDescription: string;
  severity: "low" | "medium" | "high";
  confidence?: number;
}

interface ProviderResult extends ClassificationResult {
  provider: string;
  latencyMs: number;
}

interface ComparisonResponse {
  winner: ClassificationResult;
  allResults: ProviderResult[];
  consensus: boolean;
  method: string;
}

interface CreatedReport {
  id: string;
  issueType: string | null;
  description: string | null;
  aiDescription: string | null;
  createdAt: string;
}

interface ReportLocation {
  latitude: number | null;
  longitude: number | null;
  address: string;
}

interface ClassifyInput {
  description: string;
  imageBase64: string | null;
  location: ReportLocation;
  /** Fallback error message (`common.somethingWrong`). */
  fallbackError: string;
  /** Runs before the classify request — used to clear any prior form lookup. */
  onBeforeClassify?: () => void;
  /** Runs after a successful classification with the resolved comparison. */
  onClassified?: (comparison: ComparisonResponse) => void;
}

interface SubmitInput {
  description: string;
  classification: ClassificationResult;
  location: ReportLocation;
  imageBase64: string | null;
  /** Fallback error message (`common.somethingWrong`). */
  fallbackError: string;
  /** Runs after a successful online submission. */
  onSubmitted?: (report: CreatedReport) => void;
  /** Runs after a report is queued offline (with the optimistic record). */
  onQueuedOffline?: (report: CreatedReport) => void;
}

/**
 * Owns the classify + submit network orchestration for the report flow:
 * the `/api/reports/classify` call (including its non-JSON-tolerant parsing)
 * and the `/api/reports` create call (including the offline-queue fallback),
 * plus all the loading / result / error state for both.
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

  const classify = useCallback(async (input: ClassifyInput) => {
    setClassifying(true);
    setClassifyError(null);
    try {
      input.onBeforeClassify?.();
      const res = await fetch("/api/reports/classify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: input.description,
          imageBase64: input.imageBase64,
          latitude: input.location.latitude ?? undefined,
          longitude: input.location.longitude ?? undefined,
          address: input.location.address || undefined,
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
      input.onClassified?.(data);
    } catch (e) {
      setClassifyError(e instanceof Error ? e.message : input.fallbackError);
    } finally {
      setClassifying(false);
    }
  }, []);

  const submit = useCallback(async (input: SubmitInput) => {
    setSubmitting(true);
    setSubmitError(null);

    const payload = {
      description: input.description,
      aiDescription: input.classification.aiDescription,
      issueType: input.classification.issueType,
      latitude: input.location.latitude,
      longitude: input.location.longitude,
      address: input.location.address,
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
        throw new Error(err.error || input.fallbackError);
      }

      const report: CreatedReport = await res.json();
      setCreatedReport(report);
      setSubmittedOffline(false);
      input.onSubmitted?.(report);
    } catch (e) {
      // No connectivity: park the report locally and confirm optimistically.
      // PwaSetup replays the queue once the browser is back online.
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        queueReport(payload);
        const offlineReport: CreatedReport = {
          id: "Pending sync",
          issueType: input.classification.issueType,
          description: input.description,
          aiDescription: input.classification.aiDescription,
          createdAt: new Date().toISOString(),
        };
        setCreatedReport(offlineReport);
        setSubmittedOffline(true);
        input.onQueuedOffline?.(offlineReport);
      } else {
        setSubmitError(e instanceof Error ? e.message : input.fallbackError);
      }
    } finally {
      setSubmitting(false);
    }
  }, []);

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
    setClassifyError,
    setSubmitError,
  };
}

export type {
  ClassificationResult,
  ProviderResult,
  ComparisonResponse,
  CreatedReport,
};
