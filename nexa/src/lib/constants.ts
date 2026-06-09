/**
 * Image-processing tuning constants.
 *
 * Client and server values intentionally diverge:
 *   - CLIENT_* runs in the browser canvas (quality is a 0–1 fraction) and is
 *     sized to fit under the server's ~4.5MB request-body limit (Vercel
 *     default) so uploads don't 413.
 *   - SERVER_* runs in sharp (quality is a 0–100 scale) and is tuned smaller to
 *     cut VLM token cost and latency on every classification call.
 */
export const IMAGE_PROCESSING = {
  /** Longest-edge cap (px) for the browser-side resize before upload. */
  CLIENT_MAX_DIMENSION: 1280,
  /** JPEG quality (0–1) for the browser canvas re-encode. */
  CLIENT_JPEG_QUALITY: 0.82,
  /** Longest-edge cap (px) for the server-side sharp downscale. */
  SERVER_MAX_DIMENSION: 1024,
  /** JPEG quality (0–100) for the server-side sharp re-encode. */
  SERVER_JPEG_QUALITY: 80,
} as const;

/** Browser geolocation request timeout (ms). */
export const GEOLOCATION_TIMEOUT_MS = 10000;
/** Max age (ms) of a cached browser position we'll accept before re-fetching. */
export const GEOLOCATION_CACHE_AGE_MS = 60000;

export const ISSUE_TYPE_LABELS: Record<string, string> = {
  ROAD_DAMAGE: "Road Damage",
  STREETLIGHT_OUTAGE: "Streetlight Outage",
  ILLEGAL_DUMPING: "Illegal Dumping",
  VEHICLE_EMISSIONS: "Vehicle Emissions",
  OTHER: "Other",
};

export const SEVERITY_COLORS: Record<string, string> = {
  low: "text-ep-green",
  medium: "text-yellow-500",
  high: "text-red-500",
};

const COUNTRY_NAMES = new Set([
  "United States",
  "United States of America",
  "USA",
  "U.S.A.",
  "US",
  "U.S.",
  "Canada",
  "Mexico",
  "United Kingdom",
  "UK",
]);

const US_STATE_ABBREVIATIONS: Record<string, string> = {
  Alabama: "AL",
  Alaska: "AK",
  Arizona: "AZ",
  Arkansas: "AR",
  California: "CA",
  Colorado: "CO",
  Connecticut: "CT",
  Delaware: "DE",
  Florida: "FL",
  Georgia: "GA",
  Hawaii: "HI",
  Idaho: "ID",
  Illinois: "IL",
  Indiana: "IN",
  Iowa: "IA",
  Kansas: "KS",
  Kentucky: "KY",
  Louisiana: "LA",
  Maine: "ME",
  Maryland: "MD",
  Massachusetts: "MA",
  Michigan: "MI",
  Minnesota: "MN",
  Mississippi: "MS",
  Missouri: "MO",
  Montana: "MT",
  Nebraska: "NE",
  Nevada: "NV",
  "New Hampshire": "NH",
  "New Jersey": "NJ",
  "New Mexico": "NM",
  "New York": "NY",
  "North Carolina": "NC",
  "North Dakota": "ND",
  Ohio: "OH",
  Oklahoma: "OK",
  Oregon: "OR",
  Pennsylvania: "PA",
  "Rhode Island": "RI",
  "South Carolina": "SC",
  "South Dakota": "SD",
  Tennessee: "TN",
  Texas: "TX",
  Utah: "UT",
  Vermont: "VT",
  Virginia: "VA",
  Washington: "WA",
  "West Virginia": "WV",
  Wisconsin: "WI",
  Wyoming: "WY",
  "District of Columbia": "DC",
};

/**
 * Shortens a verbose address (typically from Nominatim/Google geocoding) into a
 * compact "City, ST" or "City, Region" label.
 *
 * Example:
 *   "Coupa Cafe, 538, Ramona Street, University South, Palo Alto,
 *    Santa Clara County, California, 94301, United States"
 *   -> "Palo Alto, CA"
 */
export function shortenAddress(address: string | null | undefined): string {
  if (!address) return "";

  const parts = address
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];

  const cleaned = parts.filter((part) => {
    if (COUNTRY_NAMES.has(part)) return false;
    if (/^\d{4,6}(-\d+)?$/.test(part)) return false;
    if (/^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i.test(part)) return false;
    return true;
  });

  if (cleaned.length === 0) return parts.slice(0, 2).join(", ");
  if (cleaned.length === 1) return cleaned[0];

  const last = cleaned[cleaned.length - 1];
  const stateAbbr = US_STATE_ABBREVIATIONS[last] ?? last;

  if (cleaned.length >= 3) {
    const maybeCounty = cleaned[cleaned.length - 2];
    if (/\bCounty\b/i.test(maybeCounty)) {
      const city = cleaned[cleaned.length - 3];
      return `${city}, ${stateAbbr}`;
    }
  }

  const city = cleaned[cleaned.length - 2];
  return `${city}, ${stateAbbr}`;
}
