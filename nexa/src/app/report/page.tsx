"use client";

import { useState } from "react";
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
}

interface CreatedReport {
  id: string;
  issueType: string | null;
  description: string | null;
  aiDescription: string | null;
  createdAt: string;
}

async function fetchJSON<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || "Request failed");
  }
  return res.json();
}

export default function ReportPage() {
  const [step, setStep] = useState<ReportStep>("describe");
  const [description, setDescription] = useState("");

  const image = useImageUpload();
  const geo = useGeolocation();

  const [classifying, setClassifying] = useState(false);
  const [classification, setClassification] =
    useState<ClassificationResult | null>(null);
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
      const result = await fetchJSON<ClassificationResult>(
        "/api/reports/classify",
        { image: image.imageBase64, description: description || undefined },
      );
      setClassification(result);
      setSelectedIssueType(result.issueType);
      setStep("review");
    } catch (err) {
      setClassifyError(
        err instanceof Error ? err.message : "Something went wrong",
      );
    } finally {
      setClassifying(false);
    }
  };

  const handleSubmit = async () => {
    if (!classification) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const report = await fetchJSON<CreatedReport>("/api/reports", {
        description,
        aiDescription: classification.aiDescription,
        issueType: selectedIssueType,
        latitude: geo.latitude,
        longitude: geo.longitude,
        address: geo.address,
        imageUrl: image.imageBase64,
      });
      setCreatedReport(report);
      setStep("confirmed");
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : "Something went wrong",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    setStep("describe");
    setDescription("");
    image.clearImage();
    geo.reset();
    setClassification(null);
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
            locationLoading={geo.loading}
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
          <ReviewStep
            classification={classification}
            imagePreview={image.imagePreview}
            description={description}
            address={geo.address}
            selectedIssueType={selectedIssueType}
            submitting={submitting}
            submitError={submitError}
            onIssueTypeChange={setSelectedIssueType}
            onBack={() => setStep("describe")}
            onSubmit={handleSubmit}
          />
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
