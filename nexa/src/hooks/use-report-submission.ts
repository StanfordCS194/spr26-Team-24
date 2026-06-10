"use client";

import { useCallback, useState } from "react";
import { queueReport } from "@/lib/offline-queue";
import { uploadImageViaPresign } from "@/lib/upload-image";
import type { ApiResponse } from "@/lib/api/response";
import type {
  ClassificationResult,
  ComparisonResult,
} from "@/lib/classify/types";

// The classify route returns the canonical `ComparisonResult` (extended on the
// server with diagnostic fields this hook does not read). Re-export under the
// existing names so consumers of this hook keep their import paths.
export type {
  ClassificationResult,
  ProviderResult,
} from "@/lib/classify/types";
export type ComparisonResponse = ComparisonResult;

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
  /**
   * Agency the user chose when routing was ambiguous (more than one agency
   * covers the location + issue type). Sent to the create route, which
   * validates it against the resolved candidate set before honoring it.
   */
  selectedAgencyId?: string | null;
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
        let payload: ApiResponse<ComparisonResponse> | null = null;
        try {
          payload = rawBody
            ? (JSON.parse(rawBody) as ApiResponse<ComparisonResponse>)
            : null;
        } catch {
          throw new Error(
            `Classification failed (HTTP ${res.status}). Server returned a non-JSON response.`,
          );
        }

        if (!res.ok || !payload?.success) {
          const message =
            payload && !payload.success
              ? payload.error
              : `Classification failed (HTTP ${res.status}).`;
          throw new Error(message);
        }

        const data = payload.data;
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

      // Offline-queue payload keeps the inline base64 so a parked report can be
      // replayed without re-running the (online-only) presigned upload.
      const queuePayload = {
        description: input.description,
        aiDescription: input.classification.aiDescription,
        issueType: input.classification.issueType,
        latitude: input.latitude,
        longitude: input.longitude,
        address: input.address,
        imageUrl: input.imageBase64,
        // The create route re-resolves candidates and validates this against
        // them, so it's safe to carry through the offline queue and replay.
        ...(input.selectedAgencyId
          ? { selectedAgencyId: input.selectedAgencyId }
          : {}),
      };

      try {
        // When object storage is configured, upload the (already client-resized)
        // image to a presigned URL and store its public URL instead of the
        // bytes. `uploadImageViaPresign` returns null when storage is not
        // configured or anything fails, so we fall back to the inline base64.
        let imageUrl = input.imageBase64;
        if (input.imageBase64) {
          const objectUrl = await uploadImageViaPresign(input.imageBase64);
          if (objectUrl) imageUrl = objectUrl;
        }

        const res = await fetch("/api/reports", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...queuePayload, imageUrl }),
        });

        const result = (await res.json()) as ApiResponse<CreatedReport>;

        if (!res.ok || !result.success) {
          const message = !result.success ? result.error : null;
          throw new Error(message || callbacks.okFallback);
        }

        const report = result.data;
        setCreatedReport(report);
        setSubmittedOffline(false);
        callbacks.onSuccess(report);
      } catch (e) {
        console.error("Report submission failed:", e);
        // No connectivity: park the report locally and confirm optimistically.
        // PwaSetup replays the queue once the browser is back online.
        if (typeof navigator !== "undefined" && !navigator.onLine) {
          queueReport(queuePayload);
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
