"use client";

import { useState, useCallback, useRef } from "react";
import { reverseGeocode } from "@/lib/reverse-geocode";

export function useGeolocation() {
  const [address, setAddress] = useState("");
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Monotonic counter so a slow response from an earlier drag never overwrites
  // the result of a more recent one.
  const geocodeSeq = useRef(0);

  const setCoordinates = useCallback(
    (lat: number | null, lng: number | null) => {
      setLatitude(lat);
      setLongitude(lng);
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
      setError("Geolocation is not supported by this browser.");
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
            setError("Location permission denied. Please allow access.");
            break;
          case err.POSITION_UNAVAILABLE:
            setError("Location unavailable. Try again.");
            break;
          case err.TIMEOUT:
            setError("Location request timed out. Try again.");
            break;
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 60000,
      },
    );
  }, [setCoordinates, refreshAddress]);

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
    loading,
    error,
    setCoordinates,
    movePin,
    detect,
    reset,
  };
}
