"use client";

import { ArrowLeft, ArrowRight, ExternalLink, Loader2 } from "lucide-react";
import { ErrorBanner } from "@/components/error-banner";
import { ISSUE_TYPE_LABELS, SEVERITY_COLORS } from "@/lib/constants";

interface ClassificationResult {
  issueType: string;
  aiDescription: string;
  severity: "low" | "medium" | "high";
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

interface ReviewStepProps {
  classification: ClassificationResult;
  imagePreview: string | null;
  description: string;
  address: string;
  submitting: boolean;
  submitError: string | null;
  officialForm: OfficialFormLookupResult | null;
  officialFormLoading: boolean;
  onBack: () => void;
  onSubmit: () => void;
}

export function ReviewStep({
  classification,
  imagePreview,
  description,
  address,
  submitting,
  submitError,
  officialForm,
  officialFormLoading,
  onBack,
  onSubmit,
}: ReviewStepProps) {
  return (
    <div className="flex flex-col gap-10">
      <div>
        <span className="section-label">/ Review Classification</span>
        <h2 className="mt-3 text-2xl font-normal tracking-tight sm:text-3xl">
          Does this look right?
        </h2>
      </div>

      <div className="ep-card p-8">
        <div className="flex items-start justify-between">
          <div>
            <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
              AI Classification
            </span>
            <h3 className="mt-2 text-xl font-semibold text-foreground">
              {ISSUE_TYPE_LABELS[classification.issueType] ||
                classification.issueType}
            </h3>
          </div>
          <div
            className={`text-2xl font-normal ${SEVERITY_COLORS[classification.severity] || "text-muted-foreground"}`}
          >
            {classification.severity}
          </div>
        </div>
        <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
          {classification.aiDescription}
        </p>
      </div>

      {imagePreview && (
        <div className="ep-card overflow-hidden">
          <img
            src={imagePreview}
            alt="Issue"
            className="max-h-48 w-full object-contain p-4"
          />
        </div>
      )}

      {description && (
        <div className="ep-card p-6">
          <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
            Your Description
          </span>
          <p className="mt-2 text-sm text-foreground">{description}</p>
        </div>
      )}

      {address && (
        <div className="ep-card p-6">
          <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
            Location
          </span>
          <p className="mt-2 text-sm text-foreground">{address}</p>
        </div>
      )}

      <div className="ep-card p-6">
        <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
          Where to submit
        </span>

        {officialFormLoading ? (
          <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Finding official city form...
          </div>
        ) : officialForm?.status === "found" ? (
          <div className="mt-3">
            <p className="text-sm text-foreground">
              Official city website for {officialForm.cityName}
            </p>
            <a
              href={officialForm.formUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex items-center gap-1.5 text-sm text-ep-purple underline-offset-4 hover:underline"
            >
              Open official city form
              <ExternalLink className="size-3.5" />
            </a>
            <p className="mt-2 text-xs text-muted-foreground">
              Confidence: {officialForm.confidence}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              {officialForm.reason}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              Nexa does not submit your data to this external website.
            </p>
          </div>
        ) : (
          <div className="mt-3">
            <p className="text-sm text-foreground">
              No official city form found.
            </p>
            {officialForm?.reason && (
              <p className="mt-2 text-xs text-muted-foreground">
                {officialForm.reason}
              </p>
            )}
          </div>
        )}
      </div>

      {submitError && <ErrorBanner message={submitError} />}

      <div className="flex gap-3">
        <button
          className="btn-cta btn-cta-outline flex-1 justify-center"
          onClick={onBack}
        >
          <ArrowLeft className="size-3.5" />
          Back
        </button>
        <button
          className="btn-cta btn-cta-purple flex-1 justify-center"
          onClick={onSubmit}
          disabled={submitting}
        >
          {submitting ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Submitting...
            </>
          ) : (
            <>
              Submit Report
              <ArrowRight className="size-4" />
            </>
          )}
        </button>
      </div>
    </div>
  );
}
