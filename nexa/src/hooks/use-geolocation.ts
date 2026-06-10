"use client";

import { useState, useCallback, useRef } from "react";
import { reverseGeocode } from "@/lib/reverse-geocode";
import {
  GEOLOCATION_TIMEOUT_MS,
  GEOLOCATION_CACHE_AGE_MS,
} from "@/lib/constants";

/**
 * Where the current report coordinates came from. Drives both the UI hint and
 * the fallback precedence: a `"user"` source (GPS share, address pick, or pin
 * drag) always outranks photo `"exif"`, and `null` means no location yet.
 */
export type LocationSource = "user" | "exif" | null;

export function useGeolocation() {
  const [address, setAddress] = useState("");
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [source, setSource] = useState<LocationSource>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Monotonic counter so a slow response from an earlier drag never overwrites
  // the result of a more recent one.
  const geocodeSeq = useRef(0);

  // Keep coords + their provenance in lockstep so callers never have to set both
  // by hand. Any explicit user action (detect, address pick, pin drag) passes
  // `"user"`; clearing coords resets the source to null.
  const setCoordinates = useCallback(
    (lat: number | null, lng: number | null, src: LocationSource = "user") => {
      setLatitude(lat);
      setLongitude(lng);
      setSource(lat === null || lng === null ? null : src);
    },
    [],
  );

  /** Shared reverse-geocode: updates address to match lat/lng. */
  const refreshAddress = useCallback(async (lat: number, lng: number) => {
    const seq = ++geocodeSeq.current;
    const name = await reverseGeocode(lat, lng);
    if (seq === geocodeSeq.current) {
      setAddress(name);
    }
  }, []);

  /** Browser GPS → set coords + reverse-geocode address. */
  const detect = useCallback(() => {
    if (!navigator.geolocation) {
      setError("geo.unsupported");
      return;
    }
    setLoading(true);
    setError(null);

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        setCoordinates(lat, lng);
        setAccuracy(position.coords.accuracy);
        await refreshAddress(lat, lng);
        setLoading(false);
      },
      (err) => {
        setLoading(false);
        switch (err.code) {
          case err.PERMISSION_DENIED:
            setError("geo.denied");
            break;
          case err.POSITION_UNAVAILABLE:
            setError("geo.unavailable");
            break;
          case err.TIMEOUT:
            setError("geo.timeout");
            break;
        }
      },
      {
        enableHighAccuracy: true,
        timeout: GEOLOCATION_TIMEOUT_MS,
        maximumAge: GEOLOCATION_CACHE_AGE_MS,
      },
    );
  }, [setCoordinates, refreshAddress]);

  /**
   * Photo EXIF GPS fallback. Populates the report location from coordinates
   * extracted from the uploaded image — but only when the user has NOT already
   * supplied one. This encodes the precedence (user GPS / address pick > photo
   * EXIF): if `source` is already set we no-op, so an explicit pick is never
   * clobbered, and the result stays fully overridable afterward. Returns true
   * when the fallback was applied so callers can react if needed.
   */
  const applyExifFallback = useCallback(
    (lat: number, lng: number): boolean => {
      // Read the live source from the setter to avoid a stale closure: this is
      // called from a classify callback that may run with an older `source`.
      let applied = false;
      setSource((current) => {
        if (current !== null) return current;
        applied = true;
        return "exif";
      });
      if (!applied) return false;
      setLatitude(lat);
      setLongitude(lng);
      setAccuracy(null);
      void refreshAddress(lat, lng);
      return true;
    },
    [refreshAddress],
  );

  /** Pin drag → update coords + reverse-geocode to keep address in sync. */
  const movePin = useCallback(
    (lat: number, lng: number) => {
      setCoordinates(lat, lng);
      void refreshAddress(lat, lng);
    },
    [setCoordinates, refreshAddress],
  );

  const reset = useCallback(() => {
    geocodeSeq.current += 1;
    setAddress("");
    setCoordinates(null, null);
    setAccuracy(null);
    setError(null);
  }, [setCoordinates]);

  return {
    address,
    setAddress,
    latitude,
    longitude,
    accuracy,
    source,
    loading,
    error,
    setCoordinates,
    applyExifFallback,
    movePin,
    detect,
    reset,
  };
}
