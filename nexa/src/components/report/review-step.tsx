"use client";

import { ArrowLeft, ArrowRight, Loader2, Pencil } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ErrorBanner } from "@/components/error-banner";
import { ISSUE_TYPE_LABELS } from "@/lib/constants";

interface ClassificationResult {
  issueType: string;
  aiDescription: string;
  severity: "low" | "medium" | "high";
}

interface ReviewStepProps {
  classification: ClassificationResult;
  imagePreview: string | null;
  description: string;
  address: string;
  selectedIssueType: string | null;
  submitting: boolean;
  submitError: string | null;
  onIssueTypeChange: (value: string | null) => void;
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
  selectedIssueType,
  submitting,
  submitError,
  onIssueTypeChange,
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
        <Label className="mb-3 block font-mono text-xs uppercase tracking-wider text-muted-foreground">
          Issue Type (adjust if needed)
        </Label>
        <Select
          value={selectedIssueType}
          onValueChange={(value) => onIssueTypeChange(value)}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select issue type" />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(ISSUE_TYPE_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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
