// Submission assistant (issue #33, copy-over variant).
//
// Rather than auto-submitting, Nexa shows the user exactly what to put in each
// field of the agency's official form so they can copy it across and file it
// themselves. This maps an Agency's `requiredFields` schema onto the values we
// already have for a report.

export type PrefillField = {
  // Raw field key from the agency schema (e.g. "location_address").
  key: string;
  // Human-readable label (e.g. "Location address").
  label: string;
  // Pre-filled value from the report, or null when we have nothing to suggest.
  value: string | null;
  required: boolean;
  // The schema type ("string" | "number" | "file" | "datetime" | ...).
  type: string;
  // Extra guidance shown under the field (e.g. for photos/unknown fields).
  hint?: string;
};

type FieldSpec = { type?: string; required?: boolean; value?: unknown };

export type PrefillReport = {
  description: string | null;
  aiDescription: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  imageUrl: string | null;
  createdAt: Date | string;
  contactEmail?: string | null;
};

function humanize(key: string): string {
  const spaced = key.replace(/[_-]+/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

// Recognized token sets per derivation branch. We tokenize the key on
// non-alphanumeric boundaries and match WHOLE tokens, so `license_plate`
// (license/plate) no longer false-matches the `lat` latitude token the way the
// old `k.includes("lat")` substring check did (issue #234).
const PHOTO_TOKENS = new Set(["photo", "image", "attachment"]);
const DESCRIPTION_TOKENS = new Set([
  "description",
  "details",
  "comment",
  "comments",
  "problem",
  "issue",
]);
const ADDRESS_TOKENS = new Set([
  "address",
  "location",
  "intersection",
  "street",
]);
const LATITUDE_TOKENS = new Set(["lat", "latitude"]);
const LONGITUDE_TOKENS = new Set(["lon", "long", "lng", "longitude"]);
const EMAIL_TOKENS = new Set(["email"]);
const DATETIME_TOKENS = new Set([
  "datetime",
  "date",
  "time",
  "observed",
  "timestamp",
]);

// Split a field key into lowercased alphanumeric tokens
// (e.g. "observation_datetime" -> ["observation", "datetime"]).
function tokenize(key: string): string[] {
  return key
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function hasToken(tokens: string[], set: Set<string>): boolean {
  return tokens.some((t) => set.has(t));
}

function valueForKey(
  key: string,
  type: string,
  report: PrefillReport,
  embeddedValue?: string | null,
): { value: string | null; hint?: string } {
  const tokens = tokenize(key);
  const description =
    report.description?.trim() || report.aiDescription?.trim();

  // A field can carry an authoritative value baked into the agency schema
  // itself (e.g. the CARB hotline number, which isn't derived from the report
  // but is the channel the user must contact). When present it always wins —
  // there's nothing in the report to override it with. (issue #193)
  if (embeddedValue != null && embeddedValue !== "") {
    return { value: embeddedValue };
  }

  if (type === "file" || hasToken(tokens, PHOTO_TOKENS)) {
    return {
      value: null,
      hint: report.imageUrl
        ? "Attach the photo you uploaded to Nexa."
        : "No photo attached.",
    };
  }
  if (hasToken(tokens, DESCRIPTION_TOKENS)) {
    return { value: description ?? null };
  }
  if (hasToken(tokens, ADDRESS_TOKENS)) {
    return { value: report.address ?? null };
  }
  if (hasToken(tokens, LATITUDE_TOKENS)) {
    return { value: report.latitude != null ? String(report.latitude) : null };
  }
  if (hasToken(tokens, LONGITUDE_TOKENS)) {
    return {
      value: report.longitude != null ? String(report.longitude) : null,
    };
  }
  if (hasToken(tokens, EMAIL_TOKENS)) {
    return { value: report.contactEmail ?? null };
  }
  if (hasToken(tokens, DATETIME_TOKENS)) {
    return { value: new Date(report.createdAt).toLocaleString() };
  }

  // Fields we can't derive (e.g. license_plate, vehicle_make) — the user fills
  // these in from their own knowledge.
  return { value: null, hint: "You'll need to fill this in." };
}

/**
 * Builds the per-field copy-over guide for a report + agency required-fields
 * schema. Required fields are listed first.
 */
export function buildPrefillFields(
  report: PrefillReport,
  requiredFields: unknown,
): PrefillField[] {
  if (!requiredFields || typeof requiredFields !== "object") return [];

  const entries = Object.entries(requiredFields as Record<string, unknown>);
  const fields: PrefillField[] = entries.map(([key, rawSpec]) => {
    const spec = (rawSpec ?? {}) as FieldSpec;
    const type = typeof spec.type === "string" ? spec.type : "string";
    const required = spec.required === true;
    const embeddedValue = typeof spec.value === "string" ? spec.value : null;
    const { value, hint } = valueForKey(key, type, report, embeddedValue);
    return { key, label: humanize(key), value, required, type, hint };
  });

  // Required fields first, then by original order.
  return fields.sort((a, b) => Number(b.required) - Number(a.required));
}
