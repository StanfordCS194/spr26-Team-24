import type {
  ProviderResult,
  ComparisonResult,
  ClassificationResult,
  LocationContext,
} from "./types";
import { buildClassificationPrompt } from "./types";
import { classifyWithOpenAI } from "./openai-provider";
import { classifyWithAnthropic } from "./anthropic-provider";
import { classifyWithGoogle } from "./google-provider";
import { preprocessImage, type PreprocessedImage } from "./preprocess";
import { observeImage, renderObservation, type Observation } from "./observe";

export interface ConsensusOptions {
  /** When true and an image is supplied, run preprocessing + stage-1 observation. */
  twoStage?: boolean;
  /** Caller-supplied location context. EXIF GPS fills in when caller lacks coords. */
  location?: LocationContext | null;
}

export interface ExtendedComparisonResult extends ComparisonResult {
  /** Stage-1 observation (null when twoStage was off or stage 1 failed). */
  observation: Observation | null;
  /** Preprocessing metadata (null when no image or preprocessing failed). */
  preprocess: {
    width: number;
    height: number;
    byteLength: number;
    exifGpsUsed: boolean;
  } | null;
  /** Location actually folded into the stage-2 prompt (may include EXIF GPS). */
  locationUsed: LocationContext | null;
}

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

function toClassification(r: ProviderResult): ClassificationResult {
  return {
    issueType: r.issueType,
    aiDescription: r.aiDescription,
    severity: r.severity,
    confidence: r.confidence,
  };
}

/**
 * Pick the highest-confidence result, breaking exact confidence ties
 * deterministically.
 *
 * The previous `reduce((a, b) => a.confidence >= b.confidence ? a : b)` had two
 * subtle problems (issue #96):
 *   1. On an exact confidence tie it kept whichever element appeared first in
 *      `results`, so the outcome depended on the provider call order — a hidden,
 *      undocumented tiebreaker.
 *   2. That order is the array order from `Promise.all` (openai, anthropic,
 *      google), which is stable today but is an implementation detail, not an
 *      intended policy.
 *
 * We make the tiebreaker explicit and stable: on equal confidence, prefer the
 * lexicographically smaller `provider` name. This is a deterministic,
 * documented rule that does not depend on call ordering, so identical inputs
 * always yield the identical winner regardless of which provider responded
 * first. It is behavior-preserving for the common case (a clear confidence
 * max) and only changes the previously-arbitrary tie case.
 */
function bestByConfidence(results: ProviderResult[]): ProviderResult {
  return results.reduce((best, r) => {
    if (r.confidence > best.confidence) return r;
    if (r.confidence === best.confidence && r.provider < best.provider)
      return r;
    return best;
  });
}

function pickWinner(valid: ProviderResult[]): {
  winner: ClassificationResult;
  method: ComparisonResult["method"];
} {
  const issueTypes = valid.map((r) => r.issueType);
  const allSame = issueTypes.every((t) => t === issueTypes[0]);
  if (allSame) {
    return {
      winner: toClassification(bestByConfidence(valid)),
      method: "unanimous",
    };
  }
  const counts = new Map<string, ProviderResult[]>();
  for (const r of valid) {
    const arr = counts.get(r.issueType) ?? [];
    arr.push(r);
    counts.set(r.issueType, arr);
  }
  // Pick the strongest majority block deterministically: among issue types with
  // >= 2 votes, prefer more votes, then higher peak confidence, then
  // lexicographic issue type. Previously the first >=2 group encountered in
  // Map-iteration (i.e. provider-call) order won, which was order-dependent
  // whenever two distinct types each drew two votes.
  let bestMajority: { group: ProviderResult[]; peak: ProviderResult } | null =
    null;
  for (const group of counts.values()) {
    if (group.length < 2) continue;
    const peak = bestByConfidence(group);
    if (
      bestMajority === null ||
      group.length > bestMajority.group.length ||
      (group.length === bestMajority.group.length &&
        peak.confidence > bestMajority.peak.confidence) ||
      (group.length === bestMajority.group.length &&
        peak.confidence === bestMajority.peak.confidence &&
        peak.issueType < bestMajority.peak.issueType)
    ) {
      bestMajority = { group, peak };
    }
  }
  if (bestMajority) {
    return { winner: toClassification(bestMajority.peak), method: "majority" };
  }
  return {
    winner: toClassification(bestByConfidence(valid)),
    method: "highest-confidence",
  };
}

function mergeLocation(
  caller: LocationContext | null | undefined,
  exifGps: PreprocessedImage["exifGps"],
): { merged: LocationContext | null; exifGpsUsed: boolean } {
  const callerHasCoords =
    !!caller &&
    typeof caller.latitude === "number" &&
    typeof caller.longitude === "number";
  if (callerHasCoords) {
    return { merged: { ...caller }, exifGpsUsed: false };
  }
  if (exifGps) {
    return {
      merged: {
        ...(caller ?? {}),
        latitude: exifGps.latitude,
        longitude: exifGps.longitude,
      },
      exifGpsUsed: true,
    };
  }
  return { merged: caller ?? null, exifGpsUsed: false };
}

/**
 * Two-stage classifier with location grounding.
 *
 *   Stage 0 (preprocess): downscale image, auto-rotate, extract EXIF GPS
 *   Stage 1 (observe):    one VLM call producing {objects, conditions, hazards, scene}
 *   Stage 2 (classify):   three VLMs vote, each seeing the stage-1 observations
 *                         and location context as part of the prompt
 *
 * When `twoStage` is false (or no image is supplied), this collapses to the
 * original single-stage behavior — back-compat with existing callers.
 */
export async function classifyWithConsensus(
  description: string,
  imageBase64: string | null,
  options: ConsensusOptions = {},
): Promise<ExtendedComparisonResult> {
  let observation: Observation | null = null;
  let preprocessMeta: ExtendedComparisonResult["preprocess"] = null;
  let imageForProviders = imageBase64;
  let locationUsed: LocationContext | null = options.location ?? null;

  if (options.twoStage && imageBase64) {
    try {
      const pre = await preprocessImage(imageBase64);
      imageForProviders = pre.dataUrl;
      const merged = mergeLocation(options.location, pre.exifGps);
      locationUsed = merged.merged;
      preprocessMeta = {
        width: pre.width,
        height: pre.height,
        byteLength: pre.byteLength,
        exifGpsUsed: merged.exifGpsUsed,
      };
      try {
        observation = await observeImage(pre.dataUrl, description);
      } catch (error) {
        console.error("[classify] stage-1 observation failed:", error);
        observation = null;
      }
    } catch (error) {
      console.error("[classify] preprocessing failed:", error);
      imageForProviders = imageBase64;
    }
  }

  const stage2Prompt = buildClassificationPrompt({
    observationBlock: renderObservation(observation),
    location: locationUsed,
  });

  const results = await Promise.all([
    safeCall(
      () =>
        classifyWithOpenAI(description, imageForProviders, {
          prompt: stage2Prompt,
        }),
      "openai",
    ),
    safeCall(
      () =>
        classifyWithAnthropic(description, imageForProviders, {
          prompt: stage2Prompt,
        }),
      "anthropic",
    ),
    safeCall(
      () =>
        classifyWithGoogle(description, imageForProviders, {
          prompt: stage2Prompt,
        }),
      "google",
    ),
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
      observation,
      preprocess: preprocessMeta,
      locationUsed,
    };
  }

  const { winner, method } = pickWinner(valid);
  return {
    winner,
    allResults: valid,
    consensus: method === "unanimous" || method === "majority",
    method,
    observation,
    preprocess: preprocessMeta,
    locationUsed,
  };
}
