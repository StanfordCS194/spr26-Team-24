"use client";

import { useState, useCallback } from "react";

export function useGeolocation() {
  const [address, setAddress] = useState("");
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  const detect = useCallback(() => {
    if (!navigator.geolocation) return;
    setLoading(true);

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        setLatitude(lat);
        setLongitude(lng);

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
  }, []);

  const reset = useCallback(() => {
    setAddress("");
    setLatitude(null);
    setLongitude(null);
  }, []);

  return { address, setAddress, latitude, longitude, loading, detect, reset };
}
