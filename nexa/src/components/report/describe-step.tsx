"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Camera, MapPin, Mic, Loader2, X, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ErrorBanner } from "@/components/error-banner";
import { useSpeechRecognition } from "@/hooks/use-speech-recognition";
import { useI18n } from "@/i18n/provider";

// Leaflet touches `window` at module load, so render the map only on the client.
const LocationMap = dynamic(() => import("./location-map"), {
  ssr: false,
  loading: () => (
    <div className="mt-3 h-48 animate-pulse rounded-lg border border-border bg-muted/40" />
  ),
});

interface DescribeStepProps {
  imagePreview: string | null;
  description: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  locationLoading: boolean;
  locationSuggesting: boolean;
  addressSuggestions: string[];
  locationError: string | null;
  classifying: boolean;
  classifyError: string | null;
  canSubmit: boolean;
  onImageClick: () => void;
  onDrop: (e: React.DragEvent) => void;
  onClearImage: () => void;
  onDescriptionChange: (value: string) => void;
  onAddressChange: (value: string) => void;
  onDetectLocation: () => void;
  onLocationChange: (latitude: number, longitude: number) => void;
  onClassify: () => void;
}

export function DescribeStep({
  imagePreview,
  description,
  address,
  latitude,
  longitude,
  accuracy,
  locationLoading,
  locationSuggesting,
  addressSuggestions,
  locationError,
  classifying,
  classifyError,
  canSubmit,
  onImageClick,
  onDrop,
  onClearImage,
  onDescriptionChange,
  onAddressChange,
  onDetectLocation,
  onLocationChange,
  onClassify,
}: DescribeStepProps) {
  const { t } = useI18n();
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(-1);
  const locationWrapperRef = useRef<HTMLDivElement | null>(null);
  const speech = useSpeechRecognition();
  // Keep the latest description in a ref so the speech callback appends to the
  // current value rather than the one captured when listening started.
  const descriptionRef = useRef(description);
  useEffect(() => {
    descriptionRef.current = description;
  });

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (!locationWrapperRef.current) return;
      if (!locationWrapperRef.current.contains(event.target as Node)) {
        setSuggestionsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelectSuggestion = (suggestion: string) => {
    onAddressChange(suggestion);
    setSuggestionsOpen(false);
    setActiveSuggestion(-1);
  };

  const showSuggestions = suggestionsOpen && addressSuggestions.length > 0;
  const listboxId = "address-suggestions";
  const activeOptionId =
    showSuggestions && activeSuggestion >= 0
      ? `${listboxId}-option-${activeSuggestion}`
      : undefined;

  const handleAddressKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showSuggestions) {
      if (e.key === "ArrowDown") {
        setSuggestionsOpen(true);
      }
      return;
    }
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActiveSuggestion((prev) =>
          prev + 1 >= addressSuggestions.length ? 0 : prev + 1,
        );
        break;
      case "ArrowUp":
        e.preventDefault();
        setActiveSuggestion((prev) =>
          prev <= 0 ? addressSuggestions.length - 1 : prev - 1,
        );
        break;
      case "Enter":
        if (activeSuggestion >= 0) {
          e.preventDefault();
          handleSelectSuggestion(addressSuggestions[activeSuggestion]);
        }
        break;
      case "Escape":
        e.preventDefault();
        setSuggestionsOpen(false);
        setActiveSuggestion(-1);
        break;
    }
  };

  const handleMicToggle = () => {
    if (speech.listening) {
      speech.stop();
      return;
    }
    speech.start((text) => {
      const current = descriptionRef.current;
      onDescriptionChange(current ? `${current} ${text}` : text);
    });
  };

  return (
    <div className="flex flex-col gap-10">
      <div>
        <span className="section-label">{t("report.describeLabel")}</span>
        <h2 className="mt-3 text-2xl font-normal tracking-tight sm:text-3xl">
          {t("report.whatDidYouSee")}
        </h2>
      </div>

      <div>
        <div
          className="relative flex min-h-52 cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-muted/20 p-8 transition-colors hover:bg-muted/40"
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
          onClick={onImageClick}
        >
          {imagePreview ? (
            <div className="relative">
              <img
                src={imagePreview}
                alt={t("report.issuePreview")}
                className="max-h-64 rounded-lg object-contain"
              />
              <button
                type="button"
                aria-label={t("report.removeImage")}
                title={t("report.removeImage")}
                onClick={(e) => {
                  e.stopPropagation();
                  onClearImage();
                }}
                className="absolute -right-2 -top-2 flex size-6 items-center justify-center rounded-full bg-foreground text-background"
              >
                <X className="size-3.5" />
              </button>
            </div>
          ) : (
            <>
              <Camera className="size-10 text-muted-foreground/40" />
              <div className="text-center">
                <p className="font-medium text-foreground">
                  {t("report.uploadPhoto")}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t("report.uploadHint")}
                </p>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="ep-card p-6">
        <div className="mb-3 flex items-center justify-between gap-3">
          <Label
            htmlFor="description"
            className="block font-mono text-xs uppercase tracking-wider text-muted-foreground"
          >
            {t("report.description")}
          </Label>
          {speech.supported && (
            <button
              type="button"
              onClick={handleMicToggle}
              aria-label={
                speech.listening
                  ? t("report.stopDictation")
                  : t("report.dictateDescription")
              }
              aria-pressed={speech.listening}
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-xs uppercase tracking-wider transition-colors ${
                speech.listening
                  ? "bg-red-50 text-red-600 hover:bg-red-100"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <Mic
                className={`size-3.5 ${speech.listening ? "animate-pulse" : ""}`}
              />
              {speech.listening ? t("report.dictating") : t("report.dictate")}
            </button>
          )}
        </div>
        <Textarea
          id="description"
          placeholder={t("report.descriptionPlaceholder")}
          className="min-h-28 resize-none border-0 bg-transparent p-0 text-base shadow-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          value={description}
          onChange={(e) => onDescriptionChange(e.target.value)}
        />
        {speech.error && (
          <p className="mt-3 text-xs text-red-500">{t(speech.error)}</p>
        )}
      </div>

      <div className="ep-card p-6" ref={locationWrapperRef}>
        <Label
          htmlFor="address"
          className="mb-3 block font-mono text-xs uppercase tracking-wider text-muted-foreground"
        >
          {t("report.location")}
        </Label>
        <div className="relative flex gap-2">
          <div className="relative flex-1">
            <Input
              id="address"
              placeholder={t("report.locationPlaceholder")}
              className="border-0 bg-transparent shadow-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              value={address}
              autoComplete="off"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={showSuggestions}
              aria-controls={listboxId}
              aria-activedescendant={activeOptionId}
              onChange={(e) => {
                onAddressChange(e.target.value);
                setSuggestionsOpen(true);
                setActiveSuggestion(-1);
              }}
              onFocus={() => setSuggestionsOpen(true)}
              onKeyDown={handleAddressKeyDown}
            />
            {showSuggestions && (
              <div className="absolute left-0 right-0 top-full z-20 mt-2 overflow-hidden rounded-lg border border-border bg-card shadow-lg">
                <ul
                  id={listboxId}
                  role="listbox"
                  aria-label={t("report.addressSuggestions")}
                  className="max-h-72 overflow-y-auto py-1 text-sm"
                >
                  {addressSuggestions.map((suggestion, index) => (
                    <li
                      key={suggestion}
                      id={`${listboxId}-option-${index}`}
                      role="option"
                      aria-selected={index === activeSuggestion}
                    >
                      <button
                        type="button"
                        tabIndex={-1}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          handleSelectSuggestion(suggestion);
                        }}
                        onMouseEnter={() => setActiveSuggestion(index)}
                        className={`flex w-full items-start gap-2 px-4 py-2.5 text-left text-foreground transition-colors hover:bg-muted ${
                          index === activeSuggestion ? "bg-muted" : ""
                        }`}
                      >
                        <MapPin className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                        <span className="truncate">{suggestion}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={onDetectLocation}
            disabled={locationLoading}
            aria-label={t("report.detectLocation")}
            className="shrink-0 font-mono text-xs uppercase tracking-wider"
          >
            {locationLoading ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <MapPin className="size-3.5" />
            )}
            {locationLoading ? "..." : t("report.detect")}
          </Button>
        </div>
        {locationSuggesting && (
          <p className="mt-2 font-mono text-xs text-muted-foreground">
            {t("report.searchingLocations")}
          </p>
        )}
        {locationError && (
          <p className="mt-3 text-xs text-red-500">{t(locationError)}</p>
        )}
        {latitude !== null && longitude !== null && (
          <>
            <div className="mt-3 flex flex-wrap items-center gap-3 font-mono text-xs text-muted-foreground">
              <span>
                GPS: {latitude.toFixed(6)}, {longitude.toFixed(6)}
              </span>
              {accuracy && (
                <span
                  aria-label={t("report.gpsAccuracy", {
                    meters: Math.round(accuracy),
                  })}
                  className={`rounded-full px-2 py-0.5 ${accuracy <= 20 ? "bg-ep-green-light text-ep-green dark:bg-green-950 dark:text-green-300" : accuracy <= 100 ? "bg-yellow-50 text-yellow-600 dark:bg-yellow-950 dark:text-yellow-300" : "bg-red-50 text-red-600 dark:bg-red-950 dark:text-red-300"}`}
                >
                  ±{Math.round(accuracy)}m
                </span>
              )}
              <span className="text-muted-foreground/70">
                {t("report.dragPin")}
              </span>
            </div>
            <LocationMap
              latitude={latitude}
              longitude={longitude}
              onMove={onLocationChange}
            />
          </>
        )}
      </div>

      {classifyError && <ErrorBanner message={classifyError} />}

      <button
        className="btn-cta btn-cta-purple w-full justify-center py-4"
        onClick={onClassify}
        disabled={classifying || !canSubmit}
      >
        {classifying ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            {t("report.analyzing")}
          </>
        ) : (
          <>
            {t("report.analyze")}
            <Zap className="size-4" />
          </>
        )}
      </button>
    </div>
  );
}
