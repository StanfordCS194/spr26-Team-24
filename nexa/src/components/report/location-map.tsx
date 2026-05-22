"use client";

import { useEffect, useRef } from "react";
import type { Map as LeafletMap, Marker as LeafletMarker } from "leaflet";
import "leaflet/dist/leaflet.css";

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

export default function LocationMap({
  latitude,
  longitude,
  onMove,
}: LocationMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const markerRef = useRef<LeafletMarker | null>(null);
  const onMoveRef = useRef(onMove);
  useEffect(() => {
    onMoveRef.current = onMove;
  }, [onMove]);

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

  return (
    <div
      ref={containerRef}
      className="mt-3 h-48 w-full overflow-hidden rounded-lg border border-border"
      role="application"
      aria-label="Map showing detected location. Drag the pin to adjust."
    />
  );
}
