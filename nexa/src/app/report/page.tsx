"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePostHog } from "posthog-js/react";
import { addPendingReportId } from "@/lib/pending-reports";
import { Stepper, type ReportStep } from "@/components/report/stepper";
import { DescribeStep } from "@/components/report/describe-step";
import { ReviewStep } from "@/components/report/review-step";
import { ConfirmedStep } from "@/components/report/confirmed-step";
import { useImageUpload } from "@/hooks/use-image-upload";
import { useGeolocation } from "@/hooks/use-geolocation";
import { useAddressLookup } from "@/hooks/use-address-lookup";
import { useFormLookup } from "@/hooks/use-form-lookup";
import { useAgencyCandidates } from "@/hooks/use-agency-candidates";
import { useReportSubmission } from "@/hooks/use-report-submission";
import { useI18n } from "@/i18n/provider";

export default function ReportPage() {
  const posthog = usePostHog();
  const { t } = useI18n();
  // `time_to_submit_ms` measures the full capture -> submit loop (O1.KR2 / K2).
  // The clock starts at the user's first capture action — their first photo or
  // first keystroke of the description — NOT at page mount and NOT at the
  // classify POST. Anchoring it before classification means the reported
  // interval includes classification latency, matching the OKR definition of
  // capture -> submitted. Stays 0 until the first capture so an empty page that
  // is never used contributes nothing.
  const flowStartedAt = useRef(0);
  const markCaptureStart = useCallback(() => {
    if (flowStartedAt.current === 0) {
      flowStartedAt.current = Date.now();
    }
  }, []);

  const [step, setStep] = useState<ReportStep>("describe");
  const [description, setDescription] = useState("");

  // Provenance of the current description text, so the on-upload auto-suggestion
  // never clobbers what the user wrote. "none" = empty/untouched (safe to fill),
  // "ai" = an AI suggestion the user has not edited (safe to replace with a
  // fresh suggestion when the image changes), "user" = the user typed or edited
  // it (never overwrite). Once "user", auto-suggest leaves the field alone.
  const [descriptionSource, setDescriptionSource] = useState<
    "none" | "ai" | "user"
  >("none");

  // On-upload auto-suggestion UI state (distinct from the explicit "Analyze
  // Issue" `classifying` flag). `autoSuggesting` drives the "Analyzing photo..."
  // indicator; `detectedIssueType` surfaces the detected category as a hint.
  const [autoSuggesting, setAutoSuggesting] = useState(false);
  const [detectedIssueType, setDetectedIssueType] = useState<string | null>(
    null,
  );

  // Snapshot of `flowStartedAt` taken when the report row is created/CONFIRMED.
  // Held in state (not read off the ref during render) so it can be threaded to
  // the confirmed step's SubmissionAssistant, which emits the timed K2
  // `report_submitted` on the real agency submission (#240). React forbids
  // reading a ref's value during render, hence the snapshot here.
  const [submitCaptureStart, setSubmitCaptureStart] = useState(0);

  // When routing is ambiguous (more than one agency covers the location + issue
  // type), the review step lets the user pick one; we hold their choice here and
  // pass it to the create route, which validates it server-side.
  const [selectedAgencyId, setSelectedAgencyId] = useState<string | null>(null);

  // Anonymous reporting: a guest can complete the whole flow without an account.
  // We check session state only to decide whether to offer the post-submit
  // "create an account to track this report" upgrade prompt. `undefined` means
  // we haven't resolved it yet, so the prompt stays hidden until we know.
  const [isLoggedIn, setIsLoggedIn] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    let active = true;
    fetch("/api/auth/me")
      .then((r) => active && setIsLoggedIn(r.ok))
      .catch(() => active && setIsLoggedIn(false));
    return () => {
      active = false;
    };
  }, []);

  const handleDescriptionChange = useCallback(
    (value: string) => {
      markCaptureStart();
      setDescription(value);
      // Any manual edit (including clearing the field) marks the text as
      // user-owned so the on-upload auto-suggestion stops touching it.
      setDescriptionSource("user");
    },
    [markCaptureStart],
  );

  const image = useImageUpload();
  const geo = useGeolocation();
  const addressLookup = useAddressLookup();
  const formLookup = useFormLookup();
  const agencyCandidates = useAgencyCandidates();
  const submission = useReportSubmission();

  // Latest values the auto-suggest effect needs to read without re-firing on
  // every keystroke/location change — the effect must run only when the *image*
  // changes. Reading these off refs keeps that dependency list image-only. The
  // refs are synced in an effect (never written during render).
  const descriptionRef = useRef(description);
  const descriptionSourceRef = useRef(descriptionSource);
  const geoRef = useRef(geo);
  useEffect(() => {
    descriptionRef.current = description;
    descriptionSourceRef.current = descriptionSource;
    geoRef.current = geo;
  });

  const classify = submission.classify;
  const registerClassifyCacheKey = submission.registerClassifyCacheKey;

  // Auto-detect on photo upload: when a new image is set, quietly run the
  // existing classification (reusing the same multi-LLM path + cache) and
  // pre-fill the description with the AI's suggestion as an editable starting
  // point. Triggered by the image bytes changing — NOT by mount, keystrokes, or
  // location edits. The file-input/drop handlers already called
  // `markCaptureStart`, so this must not touch the K2 clock. Degrades silently:
  // on failure (or no AI keys) the field is simply left for the user to type.
  const lastAnalyzedImage = useRef<string | null>(null);
  useEffect(() => {
    const imageBase64 = image.imageBase64;
    // Only react to a genuinely new image. Clearing the image resets the guard
    // (so re-uploading the same bytes re-analyzes); the detected-issue hint is
    // cleared by `handleClearImage`, not here, to keep this effect free of
    // synchronous setState on the no-image path.
    if (!imageBase64) {
      lastAnalyzedImage.current = null;
      return;
    }
    if (imageBase64 === lastAnalyzedImage.current) return;
    lastAnalyzedImage.current = imageBase64;

    let cancelled = false;
    setAutoSuggesting(true);
    const g = geoRef.current;
    void classify(
      {
        description: descriptionRef.current,
        imageBase64,
        latitude: g.latitude,
        longitude: g.longitude,
        address: g.address,
      },
      {
        onSuccess: (data) => {
          if (cancelled) return;
          setDetectedIssueType(data.winner.issueType);
          // Only suggest into a field the user does not own. Read the source off
          // the ref so a description typed *during* analysis is respected.
          if (
            descriptionSourceRef.current !== "user" &&
            data.winner.aiDescription
          ) {
            setDescription(data.winner.aiDescription);
            setDescriptionSource("ai");
            // The field now holds the AI text. Alias that input combination onto
            // this same result so the explicit "Analyze Issue" — which classifies
            // with the (now AI-filled) description — is served from cache instead
            // of re-hitting the LLM for an unchanged image.
            registerClassifyCacheKey({
              description: data.winner.aiDescription,
              imageBase64,
              latitude: g.latitude,
              longitude: g.longitude,
              address: g.address,
            });
          }
        },
        // Unused on the silent path (errors are swallowed) but required by the
        // callback contract.
        errorFallback: t("common.somethingWrong"),
      },
      { silent: true },
    ).finally(() => {
      if (!cancelled) setAutoSuggesting(false);
    });

    return () => {
      cancelled = true;
    };
  }, [image.imageBase64, classify, registerClassifyCacheKey, t]);

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
    agencyCandidates.reset();
    setSelectedAgencyId(null);
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
          // Precedence: explicit user GPS / address pick > photo EXIF > none.
          // The server extracts EXIF GPS during preprocessing and reports it via
          // `preprocess.exifGpsUsed` + `locationUsed`. When the user shared no
          // location, fold those coords into the report (reverse-geocoded to an
          // address by the hook). `applyExifFallback` no-ops if the user already
          // has a location, so the explicit pick always wins and the result
          // stays overridable. `lat`/`lng` below read the (possibly updated)
          // coords so routing runs on whatever location we settled on.
          let lat = geo.latitude;
          let lng = geo.longitude;
          if (
            lat === null &&
            lng === null &&
            data.preprocess?.exifGpsUsed &&
            typeof data.locationUsed?.latitude === "number" &&
            typeof data.locationUsed?.longitude === "number"
          ) {
            geo.applyExifFallback(
              data.locationUsed.latitude,
              data.locationUsed.longitude,
            );
            lat = data.locationUsed.latitude;
            lng = data.locationUsed.longitude;
          }
          void formLookup.lookup(data.winner.issueType, {
            address: geo.address,
            latitude: lat,
            longitude: lng,
          });
          void agencyCandidates.lookup(data.winner.issueType, {
            latitude: lat,
            longitude: lng,
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
        selectedAgencyId,
        // Persisted with the queued item when offline so a successful replay can
        // emit the K2 metric from first capture -> replay (#237). 0 until the
        // first capture; the queue tolerates that.
        captureStartedAt: flowStartedAt.current,
      },
      {
        onSuccess: (report) => {
          setStep("confirmed");
          // Guests have no userId on the server row; remember this report's id so
          // the confirmed step's upgrade prompt can hand it to /api/auth/claim and
          // associate it with the account they create. Logged-in reports already
          // carry their userId, so there is nothing to claim later.
          if (isLoggedIn === false) {
            addPendingReportId(report.id);
          }
          // Creation/CONFIRMED — NOT the K2 submit event. The timed
          // `report_submitted` (with `time_to_submit_ms`) is emitted later, by
          // SubmissionAssistant, only when the report is ACTUALLY filed with the
          // agency (API/EMAIL submit returns submitted=true). Emitting it here
          // would measure capture -> CONFIRMED and fire even for WEB_FORM/PHONE
          // agencies that never auto-submit (#240). We keep a creation event for
          // funnel analytics — without `time_to_submit_ms` — and record
          // `time_to_confirm_ms` (capture -> CONFIRMED) as a separate, distinctly
          // named metric. Guard against an unstarted clock (0) so we never emit an
          // epoch-sized interval; in practice a submit always follows a capture,
          // so the fallback is defensive only.
          const captureStart = flowStartedAt.current || Date.now();
          // Hand the clock-start to the confirmed step so SubmissionAssistant can
          // emit the timed `report_submitted` from the same first-capture anchor.
          setSubmitCaptureStart(captureStart);
          posthog?.capture("report_created", {
            report_id: report.id,
            issue_type: classification.issueType,
            time_to_confirm_ms: Date.now() - captureStart,
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

  const handleClearImage = () => {
    image.clearImage();
    // The detected-issue hint belongs to the (now removed) photo; clear it.
    setDetectedIssueType(null);
    setAutoSuggesting(false);
    // If the description is an unedited AI suggestion, it was derived from the
    // photo too — drop it so it doesn't linger without its source. User-typed
    // text is left untouched.
    if (descriptionSource === "ai") {
      setDescription("");
      setDescriptionSource("none");
    }
  };

  const handleImageDrop = (e: React.DragEvent) => {
    markCaptureStart();
    image.handleDrop(e);
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    markCaptureStart();
    image.handleFileInput(e);
  };

  const resetForm = () => {
    // Re-arm the clock: the next capture action starts a fresh interval.
    flowStartedAt.current = 0;
    setSubmitCaptureStart(0);
    setStep("describe");
    setDescription("");
    setDescriptionSource("none");
    setAutoSuggesting(false);
    setDetectedIssueType(null);
    image.clearImage();
    geo.reset();
    addressLookup.reset();
    submission.reset();
    formLookup.reset();
    agencyCandidates.reset();
    setSelectedAgencyId(null);
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
            locationSource={geo.source}
            locationLoading={geo.loading}
            locationSuggesting={addressLookup.suggesting}
            addressSuggestions={addressLookup.suggestions.map(
              (suggestion) => suggestion.displayName,
            )}
            locationError={geo.error}
            classifying={submission.classifying}
            classifyError={submission.classifyError}
            autoSuggesting={autoSuggesting}
            detectedIssueType={detectedIssueType}
            descriptionIsAiSuggestion={descriptionSource === "ai"}
            canSubmit={!!(image.imageBase64 || description.trim())}
            onImageClick={() => document.getElementById("photo-input")?.click()}
            onTakePhotoClick={() =>
              document.getElementById("camera-input")?.click()
            }
            onDrop={handleImageDrop}
            onClearImage={handleClearImage}
            onDescriptionChange={handleDescriptionChange}
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
              agencyCandidates={agencyCandidates.result}
              agencyCandidatesLoading={agencyCandidates.loading}
              agencyCandidatesError={agencyCandidates.error}
              onRetryAgencyCandidates={agencyCandidates.retry}
              selectedAgencyId={selectedAgencyId}
              onSelectAgency={setSelectedAgencyId}
              onDescriptionChange={handleDescriptionChange}
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
            isLoggedIn={isLoggedIn}
            // First-capture timestamp (the K2 clock start) plus the capture
            // context. Threaded down to SubmissionAssistant so the timed
            // `report_submitted` it emits on a real agency submission measures
            // capture -> SUBMITTED and carries the same has_image/has_location
            // dimensions as the online/offline emits (#240).
            captureStartedAt={submitCaptureStart}
            hasImage={!!image.imageBase64}
            hasLocation={!!geo.latitude}
            onReportAnother={resetForm}
          />
        )}
      </div>

      {/*
        Two hidden file inputs feed the SAME `handleFileInput` so the on-upload
        auto-suggest (#261) fires regardless of which control the user picks.
        `#camera-input` carries `capture="environment"` so mobile opens the rear
        camera ("Take Photo"); `#photo-input` has no `capture` so mobile opens
        the gallery/file picker ("Upload Photo"). On desktop `capture` is ignored
        and both simply open the file picker. `#photo-input` keeps its id because
        the e2e specs set files on it directly.
      */}
      <input
        id="camera-input"
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleFileInput}
      />
      <input
        id="photo-input"
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileInput}
      />
    </main>
  );
}
