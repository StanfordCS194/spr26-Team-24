"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface AddressSuggestion {
  displayName: string;
  latitude: number;
  longitude: number;
}

/**
 * Debounced address-suggestion lookup against `/api/location/suggest`.
 *
 * Extracted from the report page so the component stays focused on UI/step
 * state. Owns the debounce timer and a monotonic request counter so a slow
 * earlier response never overwrites a newer one.
 */
export function useAddressLookup() {
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [suggesting, setSuggesting] = useState(false);
  const timerRef = useRef<number | null>(null);
  const requestRef = useRef(0);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
      }
    };
  }, []);

  const lookup = useCallback((query: string) => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    const trimmed = query.trim();
    if (trimmed.length < 3) {
      setSuggestions([]);
      setSuggesting(false);
      return;
    }

    setSuggesting(true);
    timerRef.current = window.setTimeout(async () => {
      const requestId = ++requestRef.current;

      try {
        const response = await fetch(
          `/api/location/suggest?q=${encodeURIComponent(trimmed)}`,
        );
        if (!response.ok) throw new Error("Location suggestion lookup failed.");

        const data = (await response.json()) as {
          suggestions?: AddressSuggestion[];
        };
        if (requestId !== requestRef.current) return;

        setSuggestions(data.suggestions ?? []);
      } catch (e) {
        if (requestId !== requestRef.current) return;
        console.error("Address suggestion lookup failed:", e);
        setSuggestions([]);
      } finally {
        if (requestId !== requestRef.current) return;
        setSuggesting(false);
      }
    }, 250);
  }, []);

  const reset = useCallback(() => {
    setSuggestions([]);
    setSuggesting(false);
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  return {
    suggestions,
    suggesting,
    lookup,
    setSuggestions,
    setSuggesting,
    reset,
  };
}
