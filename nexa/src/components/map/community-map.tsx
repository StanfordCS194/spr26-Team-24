"use client";

import { useEffect, useRef } from "react";
import type { LatLngTuple, Map as LeafletMap } from "leaflet";
import "leaflet/dist/leaflet.css";
import { useI18n } from "@/i18n/provider";
import { formatRelativeTime } from "@/lib/utils";

export interface IssueMapPoint {
  id: string;
  latitude: number;
  longitude: number;
  issueType: string | null;
  issueLabel: string;
  status: string;
  reportCount: number;
  createdAt: string;
  relativeTime: string;
  /** 1-based sequence in the order the issue was first filed (1 = earliest). */
  order: number;
  // The current user's own report id within this group, if they filed one.
  myReportId: string | null;
}

const TERMINAL_STATUSES = new Set(["RESOLVED", "CLOSED"]);

// Pin colour by lifecycle stage of the issue group.
function statusColor(status: string): string {
  switch (status) {
    case "RESOLVED":
    case "CLOSED":
      return "#22c55e"; // green — fixed
    case "ACKNOWLEDGED":
    case "IN_PROGRESS":
      return "#f59e0b"; // amber — being worked on
    case "DRAFT":
    case "CLASSIFYING":
      return "#94a3b8"; // slate — not yet active
    default:
      return "#9b87f5"; // purple — open / reported
  }
}

function formatStatusFallback(status: string): string {
  return status
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function translatedOrFallback(
  translate: (key: string) => string,
  key: string,
  fallback: string,
): string {
  const translated = translate(key);
  return translated === key ? fallback : translated;
}

// Teardrop pin with the issue's filing-order number rendered inside the head.
// (The reporter count stays in the popup.)
function pinSvg(color: string, order: number): string {
  const label = order > 999 ? "999+" : String(order);
  const fontSize = label.length >= 3 ? 7 : 9;
  return `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 36" width="28" height="36" aria-hidden="true">
      <defs>
        <filter id="shadow" x="-30%" y="-10%" width="160%" height="140%">
          <feDropShadow dx="0" dy="1.5" stdDeviation="1.2" flood-color="rgba(15, 23, 42, 0.35)" />
        </filter>
      </defs>
      <g filter="url(#shadow)">
        <path d="M14 1c-6.6 0-12 5.3-12 11.8 0 8.8 11 21.5 11.5 22 .3.3.8.3 1.1 0 .5-.5 11.4-13.2 11.4-22C26 6.3 20.6 1 14 1z" fill="${color}" />
        <circle cx="14" cy="13" r="6.5" fill="#ffffff" />
        <text x="14" y="13.5" text-anchor="middle" dominant-baseline="central" font-family="ui-sans-serif, system-ui, sans-serif" font-size="${fontSize}" font-weight="700" fill="${color}">${label}</text>
      </g>
    </svg>
  `;
}

interface CommunityMapProps {
  points: IssueMapPoint[];
  // Marks the caller's report in a group resolved (cascades to the whole group).
  onResolve: (reportId: string) => Promise<void>;
}

/**
 * Full-width Leaflet map of every community IssueGroup. Pins are coloured by
 * status and labelled with the reporter count; clicking one opens a popup with
 * the issue details and — when the viewer has their own report in that group and
 * it is still open — a "Mark resolved" button that resolves it for everyone.
 */
export default function CommunityMap({ points, onResolve }: CommunityMapProps) {
  const { locale, t } = useI18n();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);

  // Keep the latest resolve handler reachable from popup click listeners
  // without rebuilding the map when it changes identity.
  const onResolveRef = useRef(onResolve);
  useEffect(() => {
    onResolveRef.current = onResolve;
  }, [onResolve]);

  useEffect(() => {
    if (!containerRef.current || points.length === 0) return;

    let cancelled = false;

    (async () => {
      const leaflet = await import("leaflet");
      const L = leaflet.default ?? leaflet;
      if (cancelled || !containerRef.current) return;

      const map = L.map(containerRef.current, {
        scrollWheelZoom: true,
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
        const color = statusColor(point.status);
        const isResolved = TERMINAL_STATUSES.has(point.status);
        const issueLabel = point.issueType
          ? translatedOrFallback(
              t,
              `issue.${point.issueType}`,
              point.issueLabel,
            )
          : point.issueLabel;
        const statusLabel = translatedOrFallback(
          t,
          `status.${point.status}`,
          formatStatusFallback(point.status),
        );
        const relativeTime = formatRelativeTime(
          point.createdAt,
          locale,
          t("time.justNow"),
        );

        const icon = L.divIcon({
          className: "nexa-map-pin",
          html: pinSvg(color, point.order),
          iconSize: [28, 36],
          iconAnchor: [14, 35],
          popupAnchor: [0, -30],
        });

        const popup = document.createElement("div");
        popup.className = "nexa-map-popup";

        const reportsLabel = t(
          point.reportCount === 1 ? "map.reportSingular" : "map.reportPlural",
          { count: point.reportCount },
        );

        popup.innerHTML = `
          <p class="nexa-map-popup__label">${escapeHtml(issueLabel)}</p>
          <div class="nexa-map-popup__meta">
            <span class="nexa-map-popup__status nexa-map-popup__status--${isResolved ? "confirmed" : "pending"}">${escapeHtml(statusLabel)}</span>
            <span class="nexa-map-popup__time">${escapeHtml(reportsLabel)}</span>
          </div>
          <p class="nexa-map-popup__time">${escapeHtml(t("map.firstReported", { time: relativeTime }))}</p>
        `;

        if (point.myReportId && !isResolved) {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "nexa-map-popup__resolve";
          button.textContent = t("map.markResolved");
          button.addEventListener("click", async () => {
            const reportId = point.myReportId;
            if (!reportId) return;
            button.disabled = true;
            button.textContent = t("map.resolving");
            try {
              await onResolveRef.current(reportId);
              map.closePopup();
            } catch {
              button.disabled = false;
              button.textContent = t("map.markResolved");
            }
          });
          popup.appendChild(button);
        } else if (isResolved) {
          const note = document.createElement("p");
          note.className = "nexa-map-popup__resolved-note";
          note.textContent = t("status.RESOLVED");
          popup.appendChild(note);
        }

        L.marker([point.latitude, point.longitude], { icon })
          .addTo(map)
          .bindPopup(popup, { closeButton: true, offset: [0, -2] });

        latLngs.push([point.latitude, point.longitude]);
      }

      if (latLngs.length === 1) {
        map.setView(latLngs[0], 14);
      } else {
        map.fitBounds(latLngs, { padding: [48, 48], maxZoom: 15 });
      }
    })();

    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [locale, points, t]);

  return (
    <div
      ref={containerRef}
      // `isolate` keeps Leaflet's internal pane/control z-indexes (up to ~1000)
      // from leaking into the root stacking context and painting over the
      // navbar's account dropdown.
      className="isolate h-[calc(100vh-72px)] w-full"
      role="img"
      aria-label={t("map.aria", {
        count: points.length,
        issues:
          points.length === 1 ? t("map.issueSingular") : t("map.issuePlural"),
      })}
    />
  );
}
