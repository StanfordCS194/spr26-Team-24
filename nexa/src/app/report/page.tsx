"use client";

import { useEffect, useRef, useState } from "react";
import { usePostHog } from "posthog-js/react";
import { Stepper, type ReportStep } from "@/components/report/stepper";
import { DescribeStep } from "@/components/report/describe-step";
import { ReviewStep } from "@/components/report/review-step";
import { ConfirmedStep } from "@/components/report/confirmed-step";
import { useImageUpload } from "@/hooks/use-image-upload";
import { useGeolocation } from "@/hooks/use-geolocation";

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

type OfficialFormLookupResult =
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

interface AddressSuggestion {
  displayName: string;
  latitude: number;
  longitude: number;
}

export default function ReportPage() {
  const posthog = usePostHog();
  const flowStartedAt = useRef(0);
  useEffect(() => {
    flowStartedAt.current = Date.now();
  }, []);

  const [step, setStep] = useState<ReportStep>("describe");
  const [description, setDescription] = useState("");

  const image = useImageUpload();
  const geo = useGeolocation();

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
  const [officialForm, setOfficialForm] =
    useState<OfficialFormLookupResult | null>(null);
  const [officialFormLoading, setOfficialFormLoading] = useState(false);
  const [addressSuggestions, setAddressSuggestions] = useState<
    AddressSuggestion[]
  >([]);
  const [locationSuggesting, setLocationSuggesting] = useState(false);
  const addressLookupTimerRef = useRef<number | null>(null);
  const addressLookupRequestRef = useRef(0);

  useEffect(() => {
    return () => {
      if (addressLookupTimerRef.current) {
        window.clearTimeout(addressLookupTimerRef.current);
      }
    };
  }, []);

  const lookupAddressSuggestions = (query: string) => {
    if (addressLookupTimerRef.current) {
      window.clearTimeout(addressLookupTimerRef.current);
      addressLookupTimerRef.current = null;
    }

    const trimmed = query.trim();
    if (trimmed.length < 3) {
      setAddressSuggestions([]);
      setLocationSuggesting(false);
      return;
    }

    setLocationSuggesting(true);
    addressLookupTimerRef.current = window.setTimeout(async () => {
      const requestId = ++addressLookupRequestRef.current;

      try {
        const response = await fetch(
          `/api/location/suggest?q=${encodeURIComponent(trimmed)}`,
        );
        if (!response.ok) throw new Error("Location suggestion lookup failed.");

        const data = (await response.json()) as {
          suggestions?: AddressSuggestion[];
        };
        if (requestId !== addressLookupRequestRef.current) return;

        setAddressSuggestions(data.suggestions ?? []);
      } catch {
        if (requestId !== addressLookupRequestRef.current) return;
        setAddressSuggestions([]);
      } finally {
        if (requestId !== addressLookupRequestRef.current) return;
        setLocationSuggesting(false);
      }
    }, 250);
  };

  const lookupOfficialForm = async (issueType: string) => {
    const hasLocation =
      !!geo.address.trim() ||
      (typeof geo.latitude === "number" && typeof geo.longitude === "number");

    if (!hasLocation) {
      setOfficialForm({
        status: "not_found",
        cityName: null,
        message: "No official city form found.",
        reason: "Add a location to look up the official city website.",
      });
      return;
    }

    setOfficialFormLoading(true);
    try {
      const res = await fetch("/api/reports/form-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          issueType,
          address: geo.address || undefined,
          latitude: geo.latitude ?? undefined,
          longitude: geo.longitude ?? undefined,
        }),
      });
      if (!res.ok) throw new Error("Form lookup failed");
      const result: OfficialFormLookupResult = await res.json();
      setOfficialForm(result);
    } catch (err) {
      setOfficialForm({
        status: "not_found",
        cityName: null,
        message: "No official city form found.",
        reason:
          err instanceof Error
            ? err.message
            : "Could not look up an official city website.",
      });
    } finally {
      setOfficialFormLoading(false);
    }
  };

  const handleAddressChange = (value: string) => {
    geo.setAddress(value);

    const selectedSuggestion = addressSuggestions.find(
      (suggestion) => suggestion.displayName === value,
    );

    if (selectedSuggestion) {
      geo.setCoordinates(
        selectedSuggestion.latitude,
        selectedSuggestion.longitude,
      );
      setAddressSuggestions([]);
      setLocationSuggesting(false);
      return;
    }

    geo.setCoordinates(null, null);
    lookupAddressSuggestions(value);
  };

  const handleClassify = async () => {
    setClassifying(true);
    setClassifyError(null);
    try {
      setOfficialForm(null);
      const res = await fetch("/api/reports/classify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description,
          imageBase64: image.imageBase64,
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
      void lookupOfficialForm(data.winner.issueType);
      setStep("review");
      posthog?.capture("report_classified", {
        issue_type: data.winner.issueType,
        severity: data.winner.severity,
        has_image: !!image.imageBase64,
        has_location: !!geo.latitude,
      });
    } catch (e) {
      setClassifyError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setClassifying(false);
    }
  };

  const handleSubmit = async () => {
    if (!classification) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description,
          aiDescription: classification.aiDescription,
          issueType: classification.issueType,
          latitude: geo.latitude,
          longitude: geo.longitude,
          address: geo.address,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Submission failed");
      }

      const report: CreatedReport = await res.json();
      setCreatedReport(report);
      setStep("confirmed");
      posthog?.capture("report_submitted", {
        report_id: report.id,
        issue_type: classification.issueType,
        time_to_submit_ms: Date.now() - flowStartedAt.current,
        has_image: !!image.imageBase64,
        has_location: !!geo.latitude,
      });
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    flowStartedAt.current = Date.now();
    setStep("describe");
    setDescription("");
    image.clearImage();
    geo.reset();
    setAddressSuggestions([]);
    setLocationSuggesting(false);
    if (addressLookupTimerRef.current) {
      window.clearTimeout(addressLookupTimerRef.current);
      addressLookupTimerRef.current = null;
    }
    setClassification(null);
    setComparison(null);
    setCreatedReport(null);
    setClassifyError(null);
    setSubmitError(null);
    setOfficialForm(null);
    setOfficialFormLoading(false);
  };

  return (
    <main className="flex min-h-screen flex-col">
      <div className="border-b border-border bg-background px-6 py-6">
        <div className="mx-auto max-w-2xl">
          <Stepper current={step} />
        </div>
      </div>

      <div className="mx-auto w-full max-w-2xl flex-1 px-6 py-10">
        {step === "describe" && (
          <DescribeStep
            imagePreview={image.imagePreview}
            description={description}
            address={geo.address}
            latitude={geo.latitude}
            longitude={geo.longitude}
            accuracy={geo.accuracy}
            locationLoading={geo.loading}
            locationSuggesting={locationSuggesting}
            addressSuggestions={addressSuggestions.map(
              (suggestion) => suggestion.displayName,
            )}
            locationError={geo.error}
            classifying={classifying}
            classifyError={classifyError}
            canSubmit={!!(image.imageBase64 || description.trim())}
            onImageClick={() => document.getElementById("photo-input")?.click()}
            onDrop={image.handleDrop}
            onClearImage={image.clearImage}
            onDescriptionChange={setDescription}
            onAddressChange={handleAddressChange}
            onDetectLocation={geo.detect}
            onClassify={handleClassify}
          />
        )}

        {step === "review" && classification && (
          <>
            <ReviewStep
              classification={classification}
              imagePreview={image.imagePreview}
              description={description}
              address={geo.address}
              submitting={submitting}
              submitError={submitError}
              officialForm={officialForm}
              officialFormLoading={officialFormLoading}
              onDescriptionChange={setDescription}
              onAddressChange={geo.setAddress}
              onBack={() => setStep("describe")}
              onSubmit={handleSubmit}
            />

            {comparison && comparison.allResults.length > 1 && (
              <div className="mt-10">
                <span className="section-label">/ AI Comparison</span>
                <p className="mt-2 mb-4 text-sm text-muted-foreground">
                  Decision method:{" "}
                  <span className="font-medium text-foreground">
                    {comparison.method}
                  </span>
                  {comparison.consensus && " (models agreed)"}
                </p>
                <div className="flex flex-col gap-3">
                  {comparison.allResults.map((r) => (
                    <div
                      key={r.provider}
                      className={`ep-card p-4 ${r.issueType === comparison.winner.issueType ? "ring-2 ring-ep-green/40" : "opacity-60"}`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-xs font-medium uppercase tracking-wider">
                          {r.provider}
                        </span>
                        <span className="font-mono text-xs text-muted-foreground">
                          {r.latencyMs}ms
                        </span>
                      </div>
                      <div className="mt-2 flex items-center gap-3">
                        <span className="text-sm font-semibold">
                          {r.issueType}
                        </span>
                        <span
                          className={`rounded-full px-2 py-0.5 font-mono text-xs uppercase ${
                            r.severity === "high"
                              ? "bg-red-50 text-red-600"
                              : r.severity === "medium"
                                ? "bg-yellow-50 text-yellow-600"
                                : "bg-ep-green-light text-ep-green"
                          }`}
                        >
                          {r.severity}
                        </span>
                        <span className="font-mono text-xs text-muted-foreground">
                          {Math.round((r.confidence ?? 0) * 100)}% confident
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {r.aiDescription}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {step === "confirmed" && createdReport && (
          <ConfirmedStep report={createdReport} onReportAnother={resetForm} />
        )}
      </div>

      <input
        id="photo-input"
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={image.handleFileInput}
      />
    </main>
  );
}
