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

type FieldSpec = { type?: string; required?: boolean };

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

function valueForKey(
  key: string,
  type: string,
  report: PrefillReport,
): { value: string | null; hint?: string } {
  const k = key.toLowerCase();
  const description =
    report.description?.trim() || report.aiDescription?.trim();

  if (type === "file" || /photo|image|attachment/.test(k)) {
    return {
      value: null,
      hint: report.imageUrl
        ? "Attach the photo you uploaded to Nexa."
        : "No photo attached.",
    };
  }
  if (/description|details|comment|problem|issue/.test(k)) {
    return { value: description ?? null };
  }
  if (/address|location|intersection|street/.test(k)) {
    return { value: report.address ?? null };
  }
  if (k.includes("lat")) {
    return { value: report.latitude != null ? String(report.latitude) : null };
  }
  if (k.includes("lon") || k.includes("lng")) {
    return {
      value: report.longitude != null ? String(report.longitude) : null,
    };
  }
  if (k.includes("email")) {
    return { value: report.contactEmail ?? null };
  }
  if (/datetime|date|time|observed|observation_date/.test(k)) {
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
    const { value, hint } = valueForKey(key, type, report);
    return { key, label: humanize(key), value, required, type, hint };
  });

  // Required fields first, then by original order.
  return fields.sort((a, b) => Number(b.required) - Number(a.required));
}
