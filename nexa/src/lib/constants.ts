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

/**
 * US state/territory two-letter codes used as the registrable TLD label in the
 * `.us` locality space (RFC 1480), e.g. `paloalto.ca.us`. Used to validate that
 * a `.us` host is a real government locality — the bare `.us` TLD is openly
 * registrable. See `isOfficialCityGovUrl` in the form-link route.
 */
export const US_STATE_CODES = new Set([
  "al",
  "ak",
  "az",
  "ar",
  "ca",
  "co",
  "ct",
  "de",
  "fl",
  "ga",
  "hi",
  "id",
  "il",
  "in",
  "ia",
  "ks",
  "ky",
  "la",
  "me",
  "md",
  "ma",
  "mi",
  "mn",
  "ms",
  "mo",
  "mt",
  "ne",
  "nv",
  "nh",
  "nj",
  "nm",
  "ny",
  "nc",
  "nd",
  "oh",
  "ok",
  "or",
  "pa",
  "ri",
  "sc",
  "sd",
  "tn",
  "tx",
  "ut",
  "vt",
  "va",
  "wa",
  "wv",
  "wi",
  "wy",
  // District of Columbia and inhabited territories.
  "dc",
  "as",
  "gu",
  "mp",
  "pr",
  "vi",
]);
