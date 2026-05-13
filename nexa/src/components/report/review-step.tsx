"use client";

import {
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  Loader2,
  Pencil,
} from "lucide-react";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { ErrorBanner } from "@/components/error-banner";
import { ISSUE_TYPE_LABELS } from "@/lib/constants";

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
  onDescriptionChange: (value: string) => void;
  onAddressChange: (value: string) => void;
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
  onDescriptionChange,
  onAddressChange,
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
        <p className="mt-2 text-sm text-muted-foreground">
          Edit any field below before submitting.
        </p>
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
          <span
            className={`inline-flex items-center rounded-full px-3 py-1 font-mono text-xs font-medium uppercase tracking-wider ${
              classification.severity === "high"
                ? "bg-red-50 text-red-600"
                : classification.severity === "medium"
                  ? "bg-yellow-50 text-yellow-600"
                  : "bg-ep-green-light text-ep-green"
            }`}
          >
            {classification.severity}
          </span>
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

      <div className="ep-card p-6">
        <div className="mb-3 flex items-center gap-2">
          <Label className="block font-mono text-xs uppercase tracking-wider text-muted-foreground">
            Your Description
          </Label>
          <Pencil className="size-3 text-muted-foreground" />
        </div>
        <Textarea
          value={description}
          onChange={(e) => onDescriptionChange(e.target.value)}
          className="min-h-20 resize-none border-0 bg-transparent p-0 text-sm shadow-none focus-visible:ring-0"
          placeholder="Describe the issue..."
        />
      </div>

      <div className="ep-card p-6">
        <div className="mb-3 flex items-center gap-2">
          <Label className="block font-mono text-xs uppercase tracking-wider text-muted-foreground">
            Location
          </Label>
          <Pencil className="size-3 text-muted-foreground" />
        </div>
        <Input
          value={address}
          onChange={(e) => onAddressChange(e.target.value)}
          className="border-0 bg-transparent shadow-none focus-visible:ring-0"
          placeholder="Address or location description"
        />
      </div>

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
