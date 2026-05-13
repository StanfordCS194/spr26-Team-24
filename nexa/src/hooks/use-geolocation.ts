"use client";

import { useState, useCallback } from "react";

export function useGeolocation() {
  const [address, setAddress] = useState("");
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        setLatitude(lat);
        setLongitude(lng);
        setAccuracy(position.coords.accuracy);

        try {
          const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`,
          );
          const data = await res.json();
          if (data.display_name) setAddress(data.display_name);
        } catch {
          setAddress(`${lat.toFixed(6)}, ${lng.toFixed(6)}`);
        }

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
  }, []);

  const reset = useCallback(() => {
    setAddress("");
    setLatitude(null);
    setLongitude(null);
    setAccuracy(null);
    setError(null);
  }, []);

  return {
    address,
    setAddress,
    latitude,
    longitude,
    accuracy,
    loading,
    error,
    detect,
    reset,
  };
}
