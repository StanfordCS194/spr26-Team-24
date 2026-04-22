"use client";

import { Camera, MapPin, Loader2, X, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ErrorBanner } from "@/components/error-banner";

interface DescribeStepProps {
  imagePreview: string | null;
  description: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  locationLoading: boolean;
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
  locationLoading,
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
  return (
    <div className="flex flex-col gap-10">
      <div>
        <span className="section-label">/ Describe the Issue</span>
        <h2 className="mt-3 text-2xl font-normal tracking-tight sm:text-3xl">
          What did you see?
        </h2>
      </div>

      <div className="ep-card overflow-hidden">
        <div
          className="grid-bg relative flex min-h-52 cursor-pointer flex-col items-center justify-center gap-3 p-8 transition-colors hover:bg-muted/30"
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
        <Label
          htmlFor="description"
          className="mb-3 block font-mono text-xs uppercase tracking-wider text-muted-foreground"
        >
          Description
        </Label>
        <Textarea
          id="description"
          placeholder='e.g. "Large pothole on the corner of Elm and Main, about 2 feet wide..."'
          className="min-h-28 resize-none border-0 bg-transparent p-0 text-base shadow-none focus-visible:ring-0"
          value={description}
          onChange={(e) => onDescriptionChange(e.target.value)}
        />
      </div>

      <div className="ep-card p-6">
        <Label
          htmlFor="address"
          className="mb-3 block font-mono text-xs uppercase tracking-wider text-muted-foreground"
        >
          Location
        </Label>
        <div className="flex gap-2">
          <Input
            id="address"
            placeholder="Address or location description"
            className="border-0 bg-transparent shadow-none focus-visible:ring-0"
            value={address}
            onChange={(e) => onAddressChange(e.target.value)}
          />
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
        {latitude && longitude && (
          <p className="mt-3 font-mono text-xs text-muted-foreground">
            GPS: {latitude.toFixed(6)}, {longitude.toFixed(6)}
          </p>
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
