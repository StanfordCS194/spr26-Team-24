"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, MapPin, Mic, Loader2, X, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ErrorBanner } from "@/components/error-banner";
import { useSpeechRecognition } from "@/hooks/use-speech-recognition";

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
  onClassify,
}: DescribeStepProps) {
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
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
  };

  const showSuggestions = suggestionsOpen && addressSuggestions.length > 0;

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
        <span className="section-label">/ Describe the Issue</span>
        <h2 className="mt-3 text-2xl font-normal tracking-tight sm:text-3xl">
          What did you see?
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
                alt="Issue preview"
                className="max-h-64 rounded-lg object-contain"
              />
              <button
                type="button"
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
                <p className="font-medium text-foreground">Upload a photo</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Drag and drop or click to browse
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
            Description
          </Label>
          {speech.supported && (
            <button
              type="button"
              onClick={handleMicToggle}
              aria-label={
                speech.listening ? "Stop dictation" : "Dictate description"
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
              {speech.listening ? "Listening…" : "Dictate"}
            </button>
          )}
        </div>
        <Textarea
          id="description"
          placeholder='e.g. "Large pothole on the corner of Elm and Main, about 2 feet wide..."'
          className="min-h-28 resize-none border-0 bg-transparent p-0 text-base shadow-none focus-visible:ring-0"
          value={description}
          onChange={(e) => onDescriptionChange(e.target.value)}
        />
        {speech.error && (
          <p className="mt-3 text-xs text-red-500">{speech.error}</p>
        )}
      </div>

      <div className="ep-card p-6" ref={locationWrapperRef}>
        <Label
          htmlFor="address"
          className="mb-3 block font-mono text-xs uppercase tracking-wider text-muted-foreground"
        >
          Location
        </Label>
        <div className="relative flex gap-2">
          <div className="relative flex-1">
            <Input
              id="address"
              placeholder="Address or location description"
              className="border-0 bg-transparent shadow-none focus-visible:ring-0"
              value={address}
              autoComplete="off"
              onChange={(e) => {
                onAddressChange(e.target.value);
                setSuggestionsOpen(true);
              }}
              onFocus={() => setSuggestionsOpen(true)}
            />
            {showSuggestions && (
              <div className="absolute left-0 right-0 top-full z-20 mt-2 overflow-hidden rounded-lg border border-border bg-card shadow-lg">
                <ul className="max-h-72 overflow-y-auto py-1 text-sm">
                  {addressSuggestions.map((suggestion) => (
                    <li key={suggestion}>
                      <button
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          handleSelectSuggestion(suggestion);
                        }}
                        className="flex w-full items-start gap-2 px-4 py-2.5 text-left text-foreground transition-colors hover:bg-muted"
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
            variant="outline"
            onClick={onDetectLocation}
            disabled={locationLoading}
            className="shrink-0 font-mono text-xs uppercase tracking-wider"
          >
            {locationLoading ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <MapPin className="size-3.5" />
            )}
            {locationLoading ? "..." : "Detect"}
          </Button>
        </div>
        {locationSuggesting && (
          <p className="mt-2 font-mono text-xs text-muted-foreground">
            Searching locations...
          </p>
        )}
        {locationError && (
          <p className="mt-3 text-xs text-red-500">{locationError}</p>
        )}
        {latitude && longitude && (
          <div className="mt-3 flex flex-wrap items-center gap-3 font-mono text-xs text-muted-foreground">
            <span>
              GPS: {latitude.toFixed(6)}, {longitude.toFixed(6)}
            </span>
            {accuracy && (
              <span
                className={`rounded-full px-2 py-0.5 ${accuracy <= 20 ? "bg-ep-green-light text-ep-green" : accuracy <= 100 ? "bg-yellow-50 text-yellow-600" : "bg-red-50 text-red-600"}`}
              >
                ±{Math.round(accuracy)}m
              </span>
            )}
          </div>
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
            Analyzing with AI...
          </>
        ) : (
          <>
            Analyze Issue
            <Zap className="size-4" />
          </>
        )}
      </button>
    </div>
  );
}
