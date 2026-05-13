import type {
  ProviderResult,
  ComparisonResult,
  ClassificationResult,
} from "./types";
import { classifyWithOpenAI } from "./openai-provider";
import { classifyWithAnthropic } from "./anthropic-provider";
import { classifyWithGoogle } from "./google-provider";

async function safeCall(
  fn: () => Promise<ProviderResult>,
  provider: string,
): Promise<ProviderResult | null> {
  try {
    return await fn();
  } catch (error) {
    console.error(`[classify] ${provider} failed:`, error);
    return null;
  }
}

export async function classifyWithConsensus(
  description: string,
  imageBase64: string | null,
): Promise<ComparisonResult> {
  const results = await Promise.all([
    safeCall(() => classifyWithOpenAI(description, imageBase64), "openai"),
    safeCall(
      () => classifyWithAnthropic(description, imageBase64),
      "anthropic",
    ),
    safeCall(() => classifyWithGoogle(description, imageBase64), "google"),
  ]);

  const valid = results.filter(Boolean) as ProviderResult[];

  if (valid.length === 0) {
    return {
      winner: {
        issueType: "OTHER",
        aiDescription:
          "Unable to classify — all providers failed. Please review manually.",
        severity: "low",
        confidence: 0,
      },
      allResults: [],
      consensus: false,
      method: "fallback",
    };
  }

  // Check unanimous agreement on issueType
  const issueTypes = valid.map((r) => r.issueType);
  const allSame = issueTypes.every((t) => t === issueTypes[0]);

  if (allSame) {
    const best = valid.reduce((a, b) => (a.confidence >= b.confidence ? a : b));
    return {
      winner: toClassification(best),
      allResults: valid,
      consensus: true,
      method: "unanimous",
    };
  }

  // Check majority (2+ agree)
  const counts = new Map<string, ProviderResult[]>();
  for (const r of valid) {
    const arr = counts.get(r.issueType) ?? [];
    arr.push(r);
    counts.set(r.issueType, arr);
  }

  for (const [, group] of counts) {
    if (group.length >= 2) {
      const best = group.reduce((a, b) =>
        a.confidence >= b.confidence ? a : b,
      );
      return {
        winner: toClassification(best),
        allResults: valid,
        consensus: true,
        method: "majority",
      };
    }
  }

  // No majority — pick highest confidence
  const best = valid.reduce((a, b) => (a.confidence >= b.confidence ? a : b));
  return {
    winner: toClassification(best),
    allResults: valid,
    consensus: false,
    method: "highest-confidence",
  };
}

function toClassification(r: ProviderResult): ClassificationResult {
  return {
    issueType: r.issueType,
    aiDescription: r.aiDescription,
    severity: r.severity,
    confidence: r.confidence,
  };
}
