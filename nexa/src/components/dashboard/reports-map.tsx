"use client";

import { useEffect, useRef } from "react";
import type { LatLngTuple, Map as LeafletMap } from "leaflet";
import { MapPinned } from "lucide-react";
import "leaflet/dist/leaflet.css";
import { useI18n } from "@/i18n/provider";

export interface ReportMapPoint {
  id: string;
  latitude: number;
  longitude: number;
  issueType: string | null;
  shortLocation: string;
  status: string;
  relativeTime: string;
}

interface ReportsMapProps {
  points: ReportMapPoint[];
}

const CONFIRMED_STATUSES = new Set([
  "CONFIRMED",
  "SUBMITTING",
  "SUBMITTED",
  "ACKNOWLEDGED",
  "IN_PROGRESS",
  "RESOLVED",
  "CLOSED",
]);

function pinSvg(color: string): string {
  return `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 36" width="28" height="36" aria-hidden="true">
      <defs>
        <filter id="shadow" x="-30%" y="-10%" width="160%" height="140%">
          <feDropShadow dx="0" dy="1.5" stdDeviation="1.2" flood-color="rgba(15, 23, 42, 0.35)" />
        </filter>
      </defs>
      <g filter="url(#shadow)">
        <path d="M14 1c-6.6 0-12 5.3-12 11.8 0 8.8 11 21.5 11.5 22 .3.3.8.3 1.1 0 .5-.5 11.4-13.2 11.4-22C26 6.3 20.6 1 14 1z" fill="${color}" />
        <circle cx="14" cy="13" r="4.5" fill="#ffffff" />
      </g>
    </svg>
  `;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function ReportsMap({ points }: ReportsMapProps) {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);

  useEffect(() => {
    if (!containerRef.current || points.length === 0) return;

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

      const latLngs: LatLngTuple[] = [];

      for (const point of points) {
        const isConfirmed = CONFIRMED_STATUSES.has(point.status);
        const color = isConfirmed ? "#22c55e" : "#9b87f5";

        const icon = L.divIcon({
          className: "nexa-map-pin",
          html: pinSvg(color),
          iconSize: [28, 36],
          iconAnchor: [14, 35],
          popupAnchor: [0, -30],
        });

        const popupHtml = `
          <div class="nexa-map-popup">
            <p class="nexa-map-popup__label">${escapeHtml(point.issueType ? t(`issue.${point.issueType}`) : t("dashboard.uncategorized"))}</p>
            <p class="nexa-map-popup__title">${escapeHtml(point.shortLocation || t("dashboard.locationUnavailable"))}</p>
            <div class="nexa-map-popup__meta">
              <span class="nexa-map-popup__status nexa-map-popup__status--${isConfirmed ? "confirmed" : "pending"}">${escapeHtml(t(`status.${point.status}`))}</span>
              <span class="nexa-map-popup__time">${escapeHtml(point.relativeTime)}</span>
            </div>
          </div>
        `;

        L.marker([point.latitude, point.longitude], { icon })
          .addTo(map)
          .bindPopup(popupHtml, { closeButton: false, offset: [0, -2] });

        latLngs.push([point.latitude, point.longitude]);
      }

      if (latLngs.length === 1) {
        map.setView(latLngs[0], 14);
      } else {
        map.fitBounds(latLngs, { padding: [40, 40], maxZoom: 14 });
      }
    })();

    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [points, t]);

  if (points.length === 0) return null;

  return (
    <div className="ep-card overflow-hidden">
      <div className="flex items-center gap-2 border-b border-border px-5 py-4">
        <MapPinned
          className="size-4 text-muted-foreground"
          aria-hidden="true"
        />
        <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
          {t("dashboard.reportLocations")}
        </span>
        <span className="ml-auto font-mono text-xs text-muted-foreground">
          {points.length}{" "}
          {points.length === 1 ? t("dashboard.pin") : t("dashboard.pins")}
        </span>
      </div>
      <div
        ref={containerRef}
        className="h-[360px] w-full"
        role="img"
        aria-label={t("dashboard.mapAria", {
          count: points.length,
          locations:
            points.length === 1
              ? t("dashboard.locationSingular")
              : t("dashboard.locationPlural"),
        })}
      />
    </div>
  );
}
