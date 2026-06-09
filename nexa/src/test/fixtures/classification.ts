import type {
  ClassificationResult,
  ComparisonResult,
  ProviderResult,
} from "@/lib/classify/types";

/** A single deterministic classifier result. */
export const classificationResult: ClassificationResult = {
  issueType: "ROAD_DAMAGE",
  aiDescription:
    "A large pothole in the road surface posing a hazard to vehicles and cyclists.",
  severity: "high",
  confidence: 0.92,
};

/** Two provider results that agree — useful for consensus tests. */
export const providerResults: ProviderResult[] = [
  {
    ...classificationResult,
    provider: "openai",
    latencyMs: 820,
  },
  {
    ...classificationResult,
    confidence: 0.88,
    provider: "anthropic",
    latencyMs: 910,
  },
];

/** A unanimous comparison outcome built from the two agreeing providers. */
export const comparisonResult: ComparisonResult = {
  winner: classificationResult,
  allResults: providerResults,
  consensus: true,
  method: "unanimous",
};
