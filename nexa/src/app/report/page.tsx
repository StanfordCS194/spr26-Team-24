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
  const [selectedIssueType, setSelectedIssueType] = useState<string | null>(
    null,
  );
  const [classifyError, setClassifyError] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [createdReport, setCreatedReport] = useState<CreatedReport | null>(
    null,
  );
  const [submitError, setSubmitError] = useState<string | null>(null);

  const handleClassify = async () => {
    setClassifying(true);
    setClassifyError(null);
    try {
      const res = await fetch("/api/reports/classify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description,
          imageBase64: image.imageBase64,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Classification failed");
      }

      const data: ComparisonResponse = await res.json();
      setComparison(data);
      setClassification(data.winner);
      setSelectedIssueType(data.winner.issueType);
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
      const report: CreatedReport = {
        id: `RPT-${Date.now().toString(36).toUpperCase()}`,
        issueType: selectedIssueType,
        description,
        aiDescription: classification.aiDescription,
        createdAt: new Date().toISOString(),
      };
      setCreatedReport(report);
      setStep("confirmed");
      posthog?.capture("report_submitted", {
        report_id: report.id,
        issue_type: selectedIssueType,
        time_to_submit_ms: Date.now() - flowStartedAt.current,
        user_edited_type: selectedIssueType !== classification.issueType,
        has_image: !!image.imageBase64,
        has_location: !!geo.latitude,
      });
    } catch {
      setSubmitError("Something went wrong");
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
    setClassification(null);
    setComparison(null);
    setSelectedIssueType(null);
    setCreatedReport(null);
    setClassifyError(null);
    setSubmitError(null);
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
            locationError={geo.error}
            classifying={classifying}
            classifyError={classifyError}
            canSubmit={!!(image.imageBase64 || description.trim())}
            onImageClick={() => document.getElementById("photo-input")?.click()}
            onDrop={image.handleDrop}
            onClearImage={image.clearImage}
            onDescriptionChange={setDescription}
            onAddressChange={geo.setAddress}
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
              selectedIssueType={selectedIssueType}
              submitting={submitting}
              submitError={submitError}
              onIssueTypeChange={setSelectedIssueType}
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
