"use client";

import { useState, useCallback } from "react";

export function useGeolocation() {
  const [address, setAddress] = useState("");
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  const setCoordinates = useCallback(
    (lat: number | null, lng: number | null) => {
      setLatitude(lat);
      setLongitude(lng);
    },
    [],
  );

  const detect = useCallback(() => {
    if (!navigator.geolocation) return;
    setLoading(true);

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        setCoordinates(lat, lng);

        try {
          const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`,
          );
          const data = await res.json();
          if (data.display_name) setAddress(data.display_name);
        } catch {
          setAddress(`${lat.toFixed(6)}, ${lng.toFixed(6)}`);
        }

        setLoading(false);
      },
      () => setLoading(false),
    );
  }, [setCoordinates]);

  const reset = useCallback(() => {
    setAddress("");
    setCoordinates(null, null);
  }, [setCoordinates]);

  return {
    address,
    setAddress,
    latitude,
    longitude,
    loading,
    setCoordinates,
    detect,
    reset,
  };
}
