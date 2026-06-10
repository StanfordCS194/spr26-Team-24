import { z } from "zod";
import { extractJsonObject } from "./json";

export const ISSUE_TYPES = [
  "ROAD_DAMAGE",
  "STREETLIGHT_OUTAGE",
  "ILLEGAL_DUMPING",
  "VEHICLE_EMISSIONS",
  "OTHER",
] as const;

export const SEVERITIES = ["low", "medium", "high"] as const;

export type IssueType = (typeof ISSUE_TYPES)[number];
export type Severity = (typeof SEVERITIES)[number];

export interface ClassificationResult {
  issueType: IssueType;
  aiDescription: string;
  severity: Severity;
  confidence: number;
}

// Runtime contract for a model's classification JSON. The provider is an
// external, untrusted boundary: a model returning e.g. `{ issueType: 123 }` must
// fail here, traceably, rather than be cast through as a ClassificationResult
// and crash some unrelated consumer downstream.
const classificationResultSchema = z.object({
  issueType: z.enum(ISSUE_TYPES),
  aiDescription: z.string(),
  severity: z.enum(SEVERITIES),
  confidence: z.number(),
}) satisfies z.ZodType<ClassificationResult>;

export interface ProviderResult extends ClassificationResult {
  provider: string;
  latencyMs: number;
}

export interface ComparisonResult {
  winner: ClassificationResult;
  allResults: ProviderResult[];
  consensus: boolean;
  method: "unanimous" | "majority" | "highest-confidence" | "fallback";
}

export interface LocationContext {
  latitude?: number | null;
  longitude?: number | null;
  address?: string | null;
  jurisdiction?: string | null;
}

const BASE_CLASSIFICATION_PROMPT = `You are a civic issue classifier for a municipal reporting app called Nexa.
Analyze the provided image and/or text description of a neighborhood issue.

Respond with ONLY valid JSON matching this exact schema (no markdown, no code fences):
{
  "issueType": one of "ROAD_DAMAGE" | "STREETLIGHT_OUTAGE" | "ILLEGAL_DUMPING" | "VEHICLE_EMISSIONS" | "OTHER",
  "aiDescription": a 1-2 sentence professional description of the issue suitable for a government agency report,
  "severity": one of "low" | "medium" | "high",
  "confidence": a number 0-1 indicating classification confidence
}

Classification guidelines:
- ROAD_DAMAGE: potholes, cracked pavement, raised sidewalks, road surface issues, damaged curbs
- STREETLIGHT_OUTAGE: broken/dark streetlights, damaged light poles, flickering lights
- ILLEGAL_DUMPING: abandoned furniture, trash piles, construction debris in public areas, littering
- VEHICLE_EMISSIONS: visible exhaust smoke, idling vehicles, smog-producing vehicles
- OTHER: anything that doesn't clearly fit the above categories

Severity guidelines:
- high: immediate safety hazard or environmental contamination
- medium: significant inconvenience or moderate risk
- low: minor issue or cosmetic concern`;

/** Backward-compatible export — the original single-stage prompt. */
export const CLASSIFICATION_PROMPT = BASE_CLASSIFICATION_PROMPT;

function renderLocation(location: LocationContext | null | undefined): string {
  if (!location) return "";
  const parts: string[] = [];
  if (location.address) parts.push(`Address: ${location.address}`);
  if (
    typeof location.latitude === "number" &&
    typeof location.longitude === "number"
  ) {
    parts.push(
      `Coordinates: ${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}`,
    );
  }
  if (location.jurisdiction)
    parts.push(`Jurisdiction: ${location.jurisdiction}`);
  if (parts.length === 0) return "";
  return `\n\nReport location context:\n  ${parts.join("\n  ")}`;
}

/**
 * Build the stage-2 classification prompt. `observationBlock` is the
 * pre-rendered output of `renderObservation()` from observe.ts (kept as a
 * string here so types.ts has no runtime dependency on observe.ts).
 */
export function buildClassificationPrompt(
  options: {
    observationBlock?: string;
    location?: LocationContext | null;
  } = {},
): string {
  const sections = [BASE_CLASSIFICATION_PROMPT];
  if (options.observationBlock) sections.push(options.observationBlock);
  const loc = renderLocation(options.location);
  if (loc) sections.push(loc);
  return sections.join("\n");
}

/**
 * Parse and validate a model's classification JSON, even when wrapped in
 * markdown fences or extra prose.
 *
 * @throws {SyntaxError} When no JSON object can be located in `raw`.
 * @throws {Error} When the parsed object does not match the classification
 *   schema (bad `issueType`/`severity` enum, missing/mistyped fields) — the
 *   message names the offending fields so the failure is traceable.
 */
export function parseClassificationResponse(raw: string): ClassificationResult {
  const parsed = extractJsonObject<unknown>(raw);
  const result = classificationResultSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `Invalid classification response: ${z.prettifyError(result.error)}`,
    );
  }
  return result.data;
}
