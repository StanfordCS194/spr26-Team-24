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

const MOCK_CLASSIFICATIONS: Record<
  string,
  {
    issueType: string;
    description: string;
    severity: "low" | "medium" | "high";
  }
> = {
  pothole: {
    issueType: "ROAD_DAMAGE",
    description:
      "Pothole detected on roadway surface. Estimated diameter suggests moderate vehicle hazard. Recommended for priority repair by Public Works.",
    severity: "medium",
  },
  default: {
    issueType: "OTHER",
    description:
      "Civic issue identified from submitted photo and description. Requires review by the appropriate municipal department for classification and routing.",
    severity: "low",
  },
};

function pickMockClassification(text: string): ClassificationResult {
  const lower = text.toLowerCase();
  if (lower.match(/pothole|crack|road|pavement|asphalt/)) {
    const m = MOCK_CLASSIFICATIONS.pothole;
    return {
      issueType: m.issueType,
      aiDescription: m.description,
      severity: m.severity,
    };
  }
  if (lower.match(/light|lamp|street\s?light|dark/)) {
    return {
      issueType: "STREETLIGHT_OUTAGE",
      aiDescription:
        "Streetlight outage reported. Location flagged for electrical inspection by the city's lighting maintenance division.",
      severity: "medium",
    };
  }
  if (lower.match(/dump|trash|garbage|waste|litter/)) {
    return {
      issueType: "ILLEGAL_DUMPING",
      aiDescription:
        "Illegal dumping activity detected. Materials appear to include household waste. Flagged for environmental services cleanup.",
      severity: "high",
    };
  }
  if (lower.match(/smog|exhaust|emission|smoke|vehicle/)) {
    return {
      issueType: "VEHICLE_EMISSIONS",
      aiDescription:
        "Excessive vehicle emissions reported. Details forwarded to air quality compliance for follow-up investigation.",
      severity: "low",
    };
  }
  const m = MOCK_CLASSIFICATIONS.default;
  return {
    issueType: m.issueType,
    aiDescription: m.description,
    severity: m.severity,
  };
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
      await delay(1500);
      const result = pickMockClassification(description);
      setClassification(result);
      setSelectedIssueType(result.issueType);
      setStep("review");
    } catch {
      setClassifyError("Something went wrong");
    } finally {
      setClassifying(false);
    }
  };

  const handleSubmit = async () => {
    if (!classification) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await delay(1000);
      const report: CreatedReport = {
        id: `demo_${Date.now().toString(36)}`,
        issueType: selectedIssueType,
        description,
        aiDescription: classification.aiDescription,
        createdAt: new Date().toISOString(),
      };
      setCreatedReport(report);
      setStep("confirmed");
    } catch {
      setSubmitError("Something went wrong");
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
