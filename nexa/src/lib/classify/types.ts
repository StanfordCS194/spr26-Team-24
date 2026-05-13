export const ISSUE_TYPES = [
  "ROAD_DAMAGE",
  "STREETLIGHT_OUTAGE",
  "ILLEGAL_DUMPING",
  "VEHICLE_EMISSIONS",
  "OTHER",
] as const;

export type IssueType = (typeof ISSUE_TYPES)[number];
export type Severity = "low" | "medium" | "high";

export interface ClassificationResult {
  issueType: IssueType;
  aiDescription: string;
  severity: Severity;
  confidence: number;
}

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

export const CLASSIFICATION_PROMPT = `You are a civic issue classifier for a municipal reporting app called Nexa. 
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
