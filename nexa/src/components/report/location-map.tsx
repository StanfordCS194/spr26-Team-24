"use client";

import { useEffect, useId, useRef, type KeyboardEvent } from "react";
import type { Map as LeafletMap, Marker as LeafletMarker } from "leaflet";
import "leaflet/dist/leaflet.css";

import { useI18n } from "@/i18n/provider";

interface LocationMapProps {
  latitude: number;
  longitude: number;
  onMove: (latitude: number, longitude: number) => void;
}

/** Leaflet default marker assets (bundlers break leaflet/dist icon paths). */
const MARKER_ICON_URL =
  "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png";
const MARKER_ICON_2X_URL =
  "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png";
const MARKER_SHADOW_URL =
  "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png";

/** Degrees nudged per arrow-key press (~5.5m of latitude). */
const KEYBOARD_STEP = 0.00005;

export default function LocationMap({
  latitude,
  longitude,
  onMove,
}: LocationMapProps) {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const markerRef = useRef<LeafletMarker | null>(null);
  const onMoveRef = useRef(onMove);
  useEffect(() => {
    onMoveRef.current = onMove;
  }, [onMove]);

  // Latest coordinates, so keyboard nudges work before the first drag too.
  const positionRef = useRef({ latitude, longitude });
  useEffect(() => {
    positionRef.current = { latitude, longitude };
  }, [latitude, longitude]);

  const instructionsId = useId();

  useEffect(() => {
    if (!containerRef.current) return;

    let cancelled = false;

    (async () => {
      const leaflet = await import("leaflet");
      const L = leaflet.default ?? leaflet;
      if (cancelled || !containerRef.current) return;

      const map = L.map(containerRef.current, {
        scrollWheelZoom: false,
        zoomControl: true,
        attributionControl: true,
      });
      mapRef.current = map;

      L.tileLayer(
        "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
        {
          attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
          subdomains: "abcd",
          maxZoom: 19,
        },
      ).addTo(map);

      const icon = L.icon({
        iconUrl: MARKER_ICON_URL,
        iconRetinaUrl: MARKER_ICON_2X_URL,
        shadowUrl: MARKER_SHADOW_URL,
        iconSize: [25, 41],
        iconAnchor: [12, 41],
        popupAnchor: [1, -34],
        shadowSize: [41, 41],
      });

      const marker = L.marker([latitude, longitude], {
        icon,
        draggable: true,
      }).addTo(map);
      markerRef.current = marker;

      marker.on("dragend", () => {
        const { lat, lng } = marker.getLatLng();
        onMoveRef.current(lat, lng);
      });

      map.setView([latitude, longitude], 16);
    })();

    return () => {
      cancelled = true;
      markerRef.current = null;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
    // Init map once per mount; prop updates handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const marker = markerRef.current;
    if (!map || !marker) return;
    marker.setLatLng([latitude, longitude]);
    map.setView([latitude, longitude], map.getZoom(), { animate: true });
  }, [latitude, longitude]);

  // Keyboard parity with mouse drag: arrow keys nudge the pin and feed the same
  // onMove handler. Falls back to props so it works even before Leaflet loads.
  const nudge = (deltaLat: number, deltaLng: number) => {
    const marker = markerRef.current;
    const current = marker
      ? marker.getLatLng()
      : {
          lat: positionRef.current.latitude,
          lng: positionRef.current.longitude,
        };
    const nextLat = current.lat + deltaLat;
    const nextLng = current.lng + deltaLng;
    onMoveRef.current(nextLat, nextLng);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    switch (event.key) {
      case "ArrowUp":
        event.preventDefault();
        nudge(KEYBOARD_STEP, 0);
        break;
      case "ArrowDown":
        event.preventDefault();
        nudge(-KEYBOARD_STEP, 0);
        break;
      case "ArrowLeft":
        event.preventDefault();
        nudge(0, -KEYBOARD_STEP);
        break;
      case "ArrowRight":
        event.preventDefault();
        nudge(0, KEYBOARD_STEP);
        break;
      default:
        break;
    }
  };

  return (
    <div className="relative mt-3">
      <div
        ref={containerRef}
        className="h-48 w-full overflow-hidden rounded-lg border border-border"
        role="application"
        aria-label={t("report.mapAdjustLabel")}
      />
      {/* Keyboard parity for the draggable pin: a focusable control that nudges
          the marker via the same onMove handler. Sibling (not a Leaflet-owned
          child) so Leaflet's DOM ownership of the container is never disturbed.
          Visually hidden by default (mouse users just drag the pin) but revealed
          on focus so keyboard / screen-reader users still get the control. */}
      <button
        type="button"
        aria-label={t("report.mapPinKeyboardLabel")}
        aria-describedby={instructionsId}
        onKeyDown={handleKeyDown}
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-[1000] focus:rounded-md focus:border focus:border-border focus:bg-background/90 focus:px-2 focus:py-1 focus:text-xs focus:text-muted-foreground focus:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {t("report.mapPinKeyboardLabel")}
      </button>
      <p id={instructionsId} className="sr-only">
        {t("report.mapPinKeyboardInstructions")}
      </p>
    </div>
  );
}
