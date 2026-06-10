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
import { useI18n } from "@/i18n/provider";
import type { ClassificationResult } from "@/lib/classify/types";
import type {
  AgencyCandidatesResult,
  OfficialFormLookupResult,
} from "@/lib/api/types";

interface ReviewStepProps {
  classification: ClassificationResult;
  imagePreview: string | null;
  description: string;
  address: string;
  submitting: boolean;
  submitError: string | null;
  officialForm: OfficialFormLookupResult | null;
  officialFormLoading: boolean;
  /**
   * Candidate agencies for this report's location + issue type. When more than
   * one covers the same spot (an ambiguous match), the review step renders a
   * picker so the user disambiguates which one to file with.
   */
  agencyCandidates: AgencyCandidatesResult | null;
  /** Whether the candidate fetch is still in flight. */
  agencyCandidatesLoading: boolean;
  /**
   * True when the candidate fetch failed. The user is never blocked by this —
   * the create route still routes/validates server-side — but we surface a
   * retry so they aren't left at a silent dead-end.
   */
  agencyCandidatesError: boolean;
  /** Re-runs the candidate fetch after a failure. */
  onRetryAgencyCandidates: () => void;
  /** The agency the user has selected from an ambiguous candidate set. */
  selectedAgencyId: string | null;
  onSelectAgency: (agencyId: string) => void;
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
  agencyCandidates,
  agencyCandidatesLoading,
  agencyCandidatesError,
  onRetryAgencyCandidates,
  selectedAgencyId,
  onSelectAgency,
  onDescriptionChange,
  onAddressChange,
  onBack,
  onSubmit,
}: ReviewStepProps) {
  const { t } = useI18n();

  // Ambiguous routing: more than one agency covers this location + issue type
  // (e.g. Menlo Park's web-form desk vs. its Open311 API). Surface the
  // candidates with a disambiguating question and let the user pick one. A
  // single confident match needs no prompt — the create route routes it.
  const isAmbiguous =
    !!agencyCandidates &&
    agencyCandidates.candidates.length > 1 &&
    !agencyCandidates.agencyId;

  // The fetch resolved but no agency covers this location + issue type. Not an
  // error: the user can still submit and the create route routes/validates it.
  // We say so plainly rather than leaving the section blank.
  const isEmptyCandidates =
    !!agencyCandidates &&
    agencyCandidates.candidates.length === 0 &&
    !agencyCandidates.agencyId;

  return (
    <div className="flex flex-col gap-10">
      <div>
        <span className="section-label">{t("report.reviewLabel")}</span>
        <h2 className="mt-3 text-2xl font-normal tracking-tight sm:text-3xl">
          {t("report.reviewTitle")}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("report.reviewHint")}
        </p>
      </div>

      <div className="ep-card p-8">
        <div className="flex items-start justify-between">
          <div>
            <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
              {t("report.aiClassification")}
            </span>
            <h3 className="mt-2 text-xl font-semibold text-foreground">
              {t(`issue.${classification.issueType}`) ||
                classification.issueType}
            </h3>
          </div>
          <span
            className={`inline-flex items-center rounded-full px-3 py-1 font-mono text-xs font-medium uppercase tracking-wider ${
              classification.severity === "high"
                ? "bg-red-50 text-red-600 dark:bg-red-950 dark:text-red-300"
                : classification.severity === "medium"
                  ? "bg-yellow-50 text-yellow-600 dark:bg-yellow-950 dark:text-yellow-300"
                  : "bg-ep-green-light text-ep-green dark:bg-green-950 dark:text-green-300"
            }`}
          >
            {t(`severity.${classification.severity}`)}
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
            alt={t("report.issuePreview")}
            className="max-h-48 w-full object-contain p-4"
          />
        </div>
      )}

      <div className="ep-card p-6">
        <div className="mb-3 flex items-center gap-2">
          <Label className="block font-mono text-xs uppercase tracking-wider text-muted-foreground">
            {t("report.yourDescription")}
          </Label>
          <Pencil className="size-3 text-muted-foreground" />
        </div>
        <Textarea
          value={description}
          onChange={(e) => onDescriptionChange(e.target.value)}
          className="min-h-20 resize-none border-0 bg-transparent p-0 text-sm shadow-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          placeholder={t("report.describeIssue")}
        />
      </div>

      <div className="ep-card p-6">
        <div className="mb-3 flex items-center gap-2">
          <Label className="block font-mono text-xs uppercase tracking-wider text-muted-foreground">
            {t("report.location")}
          </Label>
          <Pencil className="size-3 text-muted-foreground" />
        </div>
        <Input
          value={address}
          onChange={(e) => onAddressChange(e.target.value)}
          className="border-0 bg-transparent shadow-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          placeholder={t("report.locationPlaceholder")}
        />
      </div>

      <div className="ep-card p-6">
        <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
          {t("report.whereSubmit")}
        </span>

        {officialFormLoading ? (
          <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            {t("report.findingForm")}
          </div>
        ) : officialForm?.status === "found" ? (
          <div className="mt-3">
            <p className="text-sm text-foreground">
              {t("report.officialWebsite", { city: officialForm.cityName })}
            </p>
            <a
              href={officialForm.formUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex items-center gap-1.5 text-sm text-ep-purple underline-offset-4 hover:underline"
            >
              {t("report.openOfficialForm")}
              <ExternalLink className="size-3.5" />
            </a>
            <p className="mt-2 text-xs text-muted-foreground">
              {t("report.confidence", { confidence: officialForm.confidence })}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              {officialForm.reason}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              {t("report.externalNotice")}
            </p>
          </div>
        ) : (
          <div className="mt-3">
            <p className="text-sm text-foreground">
              {t("report.noOfficialForm")}
            </p>
            {officialForm?.reason && (
              <p className="mt-2 text-xs text-muted-foreground">
                {officialForm.reason}
              </p>
            )}
          </div>
        )}
      </div>

      {isAmbiguous && (
        <div className="ep-card p-6">
          <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
            {t("report.chooseAgency")}
          </span>
          {agencyCandidates?.disambiguation && (
            <p className="mt-2 text-sm text-foreground">
              {agencyCandidates.disambiguation}
            </p>
          )}
          <div className="mt-3 flex flex-col gap-2" role="radiogroup">
            {agencyCandidates?.candidates.map((candidate) => {
              const selected = candidate.id === selectedAgencyId;
              return (
                <button
                  key={candidate.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => onSelectAgency(candidate.id)}
                  className={`flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors ${
                    selected
                      ? "border-ep-purple bg-ep-purple/5 ring-2 ring-ep-purple/40"
                      : "border-border hover:border-ep-purple/50"
                  }`}
                >
                  <span className="text-sm font-medium text-foreground">
                    {candidate.name}
                  </span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {candidate.jurisdiction} ·{" "}
                    {t(`report.intake.${candidate.intakeMethod}`)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {agencyCandidatesError && (
        <div className="flex flex-col gap-3">
          <ErrorBanner message={t("report.candidateError")} />
          <button
            type="button"
            className="btn-cta btn-cta-outline self-start"
            onClick={onRetryAgencyCandidates}
            disabled={agencyCandidatesLoading}
          >
            {agencyCandidatesLoading ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                {t("report.candidateRetrying")}
              </>
            ) : (
              t("report.candidateRetry")
            )}
          </button>
        </div>
      )}

      {isEmptyCandidates && (
        <div className="ep-card p-6">
          <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
            {t("report.chooseAgency")}
          </span>
          <p className="mt-2 text-sm text-muted-foreground">
            {t("report.noAgencyMatch")}
          </p>
        </div>
      )}

      {submitError && <ErrorBanner message={submitError} />}

      <div className="flex gap-3">
        <button
          className="btn-cta btn-cta-outline flex-1 justify-center"
          onClick={onBack}
        >
          <ArrowLeft className="size-3.5" />
          {t("common.back")}
        </button>
        <button
          className="btn-cta btn-cta-purple flex-1 justify-center"
          onClick={onSubmit}
          disabled={submitting || (isAmbiguous && !selectedAgencyId)}
        >
          {submitting ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              {t("report.submitting")}
            </>
          ) : (
            <>
              {t("report.submit")}
              <ArrowRight className="size-4" />
            </>
          )}
        </button>
      </div>
    </div>
  );
}
