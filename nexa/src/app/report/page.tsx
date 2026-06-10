"use client";

import { useEffect, useRef, useState } from "react";
import { usePostHog } from "posthog-js/react";
import { Stepper, type ReportStep } from "@/components/report/stepper";
import { DescribeStep } from "@/components/report/describe-step";
import { ReviewStep } from "@/components/report/review-step";
import { ConfirmedStep } from "@/components/report/confirmed-step";
import { useImageUpload } from "@/hooks/use-image-upload";
import { useGeolocation } from "@/hooks/use-geolocation";
import { useAddressLookup } from "@/hooks/use-address-lookup";
import { useFormLookup } from "@/hooks/use-form-lookup";
import { useReportSubmission } from "@/hooks/use-report-submission";
import { useI18n } from "@/i18n/provider";

export default function ReportPage() {
  const posthog = usePostHog();
  const { t } = useI18n();
  const flowStartedAt = useRef(0);
  useEffect(() => {
    flowStartedAt.current = Date.now();
  }, []);

  const [step, setStep] = useState<ReportStep>("describe");
  const [description, setDescription] = useState("");

  const image = useImageUpload();
  const geo = useGeolocation();
  const addressLookup = useAddressLookup();
  const formLookup = useFormLookup();
  const submission = useReportSubmission();

  const handleAddressChange = (value: string) => {
    geo.setAddress(value);

    const selectedSuggestion = addressLookup.suggestions.find(
      (suggestion) => suggestion.displayName === value,
    );

    if (selectedSuggestion) {
      geo.setCoordinates(
        selectedSuggestion.latitude,
        selectedSuggestion.longitude,
      );
      addressLookup.setSuggestions([]);
      addressLookup.setSuggesting(false);
      return;
    }

    geo.setCoordinates(null, null);
    addressLookup.lookup(value);
  };

  const handleClassify = async () => {
    formLookup.setOfficialForm(null);
    await submission.classify(
      {
        description,
        imageBase64: image.imageBase64,
        latitude: geo.latitude,
        longitude: geo.longitude,
        address: geo.address,
      },
      {
        onSuccess: (data) => {
          void formLookup.lookup(data.winner.issueType, {
            address: geo.address,
            latitude: geo.latitude,
            longitude: geo.longitude,
          });
          setStep("review");
          posthog?.capture("report_classified", {
            issue_type: data.winner.issueType,
            severity: data.winner.severity,
            has_image: !!image.imageBase64,
            has_location: !!geo.latitude,
          });
        },
        errorFallback: t("common.somethingWrong"),
      },
    );
  };

  const handleSubmit = async () => {
    if (!submission.classification) return;
    const classification = submission.classification;
    await submission.submit(
      {
        description,
        classification,
        latitude: geo.latitude,
        longitude: geo.longitude,
        address: geo.address,
        imageBase64: image.imageBase64,
      },
      {
        onSuccess: (report) => {
          setStep("confirmed");
          posthog?.capture("report_submitted", {
            report_id: report.id,
            issue_type: classification.issueType,
            time_to_submit_ms: Date.now() - flowStartedAt.current,
            has_image: !!image.imageBase64,
            has_location: !!geo.latitude,
          });
        },
        onQueuedOffline: () => {
          setStep("confirmed");
          posthog?.capture("report_queued_offline", {
            issue_type: classification.issueType,
            has_image: !!image.imageBase64,
            has_location: !!geo.latitude,
          });
        },
        // Two intentionally distinct fallbacks (do not merge):
        // `okFallback` covers the `/api/reports` `!res.ok` branch, while
        // `offlineElseFallback` covers the catch's online (offline-ELSE) path.
        okFallback: t("report.submit"),
        offlineElseFallback: t("common.somethingWrong"),
      },
    );
  };

  const resetForm = () => {
    flowStartedAt.current = Date.now();
    setStep("describe");
    setDescription("");
    image.clearImage();
    geo.reset();
    addressLookup.reset();
    submission.reset();
    formLookup.reset();
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
            locationSuggesting={addressLookup.suggesting}
            addressSuggestions={addressLookup.suggestions.map(
              (suggestion) => suggestion.displayName,
            )}
            locationError={geo.error}
            classifying={submission.classifying}
            classifyError={submission.classifyError}
            canSubmit={!!(image.imageBase64 || description.trim())}
            onImageClick={() => document.getElementById("photo-input")?.click()}
            onDrop={image.handleDrop}
            onClearImage={image.clearImage}
            onDescriptionChange={setDescription}
            onAddressChange={handleAddressChange}
            onDetectLocation={geo.detect}
            onLocationChange={geo.movePin}
            onClassify={handleClassify}
          />
        )}

        {step === "review" && submission.classification && (
          <>
            <ReviewStep
              classification={submission.classification}
              imagePreview={image.imagePreview}
              description={description}
              address={geo.address}
              submitting={submission.submitting}
              submitError={submission.submitError}
              officialForm={formLookup.officialForm}
              officialFormLoading={formLookup.loading}
              onDescriptionChange={setDescription}
              onAddressChange={geo.setAddress}
              onBack={() => setStep("describe")}
              onSubmit={handleSubmit}
            />

            {submission.comparison &&
              submission.comparison.allResults.length > 1 &&
              (() => {
                const comparison = submission.comparison;
                return (
                  <div className="mt-10">
                    <span className="section-label">
                      {t("report.aiComparison")}
                    </span>
                    <p className="mt-2 mb-4 text-sm text-muted-foreground">
                      {t("report.decisionMethod")}{" "}
                      <span className="font-medium text-foreground">
                        {comparison.method}
                      </span>
                      {comparison.consensus && t("report.modelsAgreed")}
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
                              {t(`issue.${r.issueType}`)}
                            </span>
                            <span
                              className={`rounded-full px-2 py-0.5 font-mono text-xs uppercase ${
                                r.severity === "high"
                                  ? "bg-red-50 text-red-600 dark:bg-red-950 dark:text-red-300"
                                  : r.severity === "medium"
                                    ? "bg-yellow-50 text-yellow-600 dark:bg-yellow-950 dark:text-yellow-300"
                                    : "bg-ep-green-light text-ep-green dark:bg-green-950 dark:text-green-300"
                              }`}
                            >
                              {t(`severity.${r.severity}`)}
                            </span>
                            <span className="font-mono text-xs text-muted-foreground">
                              {t("report.confident", {
                                percent: Math.round((r.confidence ?? 0) * 100),
                              })}
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {r.aiDescription}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
          </>
        )}

        {step === "confirmed" && submission.createdReport && (
          <ConfirmedStep
            report={submission.createdReport}
            offline={submission.submittedOffline}
            onReportAnother={resetForm}
          />
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
