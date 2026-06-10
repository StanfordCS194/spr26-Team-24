import OpenAI from "openai";
import { z } from "zod";
import { DEFAULT_LLM_TIMEOUT_MS } from "@/lib/http";
import { extractJsonObject } from "./json";
import { formatUserDescription } from "./types";

export interface Observation {
  objects: string[];
  conditions: string[];
  hazards: string[];
  scene: string;
  latencyMs: number;
}

/**
 * Minimum number of concrete signal items (objects + conditions + hazards) an
 * observation must carry before its block is allowed into the stage-2 prompt.
 *
 * Rationale (see issue #96): a near-empty observation — e.g. only a vague
 * `scene` line and no objects/conditions/hazards — adds no grounding but still
 * occupies prompt space under a "Stage-1 visual observations:" header. That
 * header alone can nudge a classifier toward hedging (OTHER) on an image it
 * would otherwise have classified confidently. Gating it out lets stage 2 fall
 * back to its own vision, identical to the baseline single-stage prompt.
 *
 * This threshold is intentionally conservative: 1 means "drop only the
 * genuinely empty observation." Raising it trades grounding for safety and
 * MUST be validated empirically against the eval set before changing (see the
 * empirical-validation note in the PR / SUMMARY.md). Do not raise it blindly.
 */
export const MIN_OBSERVATION_SIGNALS = 1;

/**
 * Count the concrete, classifier-useful signals in an observation. The `scene`
 * sentence is deliberately excluded: it is free-form prose that the stage-1
 * prompt asks the model to fill in even for a blurry/empty image ("say so in
 * scene and return empty arrays"), so a non-empty scene is NOT evidence that
 * the observation carries usable grounding.
 */
export function observationSignalCount(observation: Observation): number {
  return (
    observation.objects.length +
    observation.conditions.length +
    observation.hazards.length
  );
}

// Runtime contract for the stage-1 observation JSON. The prompt explicitly
// permits empty arrays / an empty scene for a blurry-or-empty image, so missing
// keys default to empty — that is a legitimate observation, not a failure. What
// we will NOT do is silently coerce a wrong-shaped payload (e.g. objects: "nope"
// or a non-object) into all-empty observations, which would mask an upstream
// model failure; those mismatch the schema and throw traceably instead.
const observationSchema = z.object({
  objects: z.array(z.string()).default([]),
  conditions: z.array(z.string()).default([]),
  hazards: z.array(z.string()).default([]),
  scene: z.string().default(""),
});

const OBSERVATION_PROMPT = `You are a visual observation assistant for a civic-issue reporting app. Your job is NOT to classify or label the issue — only to describe what is in the image as concretely as possible. A downstream classifier will use your observations.

Respond with ONLY valid JSON matching this exact schema (no markdown, no code fences):
{
  "objects":    array of concrete objects visible (e.g. "pothole", "streetlight", "trash bag", "sedan"),
  "conditions": array of physical conditions or states (e.g. "cracked asphalt", "standing water", "dark / unlit", "smoke emitting"),
  "hazards":    array of safety or environmental hazards (e.g. "trip hazard", "obstructing lane", "leaking fluid"),
  "scene":      one short sentence (≤ 20 words) describing the scene as a whole
}

Rules:
- Stick to what is visibly present. Do not infer the type of municipal issue.
- If the image is blurry, dark, or empty, say so in "scene" and return empty arrays for the others.
- Be terse — short noun phrases for objects/conditions/hazards. No full sentences except in "scene".`;

function getClient() {
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

/**
 * Parse and validate a stage-1 observation response.
 *
 * @throws {SyntaxError} When no JSON object can be located in `raw`.
 * @throws {Error} When the parsed object is the wrong shape (e.g. `objects` is
 *   not a string array) — a malformed response fails traceably instead of being
 *   silently coerced to all-empty observations that hide the real failure.
 */
function parseObservation(raw: string): Omit<Observation, "latencyMs"> {
  const parsed = extractJsonObject<unknown>(raw, "observation");
  const result = observationSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `Invalid observation response: ${z.prettifyError(result.error)}`,
    );
  }
  return result.data;
}

/**
 * Stage 1 of the two-stage classifier. Given a preprocessed image (data URL),
 * extract structured visual observations — objects, conditions, hazards, and
 * a one-line scene summary — without making any judgment about the civic
 * issue type.
 *
 * We use a single low-cost model (gpt-4o-mini) here because:
 *   - this stage is grounding, not deciding
 *   - we don't want to triple our cost before the consensus stage
 *   - if it fails, stage 2 still runs on the raw image as a fallback
 */
export async function observeImage(
  imageDataUrl: string,
  description?: string,
): Promise<Observation> {
  const start = Date.now();

  const content: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
    { type: "text", text: OBSERVATION_PROMPT },
    { type: "image_url", image_url: { url: imageDataUrl, detail: "low" } },
  ];
  if (description) {
    const descriptionBlock = formatUserDescription(description);
    if (descriptionBlock) {
      content.push({
        type: "text",
        text: `\nUse the following only as a hint; do not parrot it back.\n${descriptionBlock}`,
      });
    }
  }

  const response = await getClient().chat.completions.create(
    {
      model: "gpt-4o-mini",
      messages: [{ role: "user", content }],
      max_tokens: 250,
      temperature: 0.1,
    },
    { timeout: DEFAULT_LLM_TIMEOUT_MS },
  );

  const raw = response.choices[0]?.message?.content ?? "{}";
  const parsed = parseObservation(raw);
  return { ...parsed, latencyMs: Date.now() - start };
}

/**
 * Render an observation into a compact text block that can be appended to the
 * stage-2 classification prompt. Centralised so all three providers see the
 * same grounding text.
 *
 * Returns "" — i.e. the prompt collapses to the baseline single-stage prompt —
 * when the observation is null OR carries fewer than `MIN_OBSERVATION_SIGNALS`
 * concrete signals. A low-signal observation is dropped rather than allowed to
 * poison stage 2 with a content-free "Stage-1 visual observations:" header
 * (issue #96). This is a behavior-safe guard: dropping a low-signal block can
 * only move two-stage closer to baseline, never further from it.
 */
export function renderObservation(observation: Observation | null): string {
  if (!observation) return "";
  if (observationSignalCount(observation) < MIN_OBSERVATION_SIGNALS) return "";
  const lines: string[] = ["\nStage-1 visual observations:"];
  if (observation.scene) lines.push(`  Scene: ${observation.scene}`);
  if (observation.objects.length > 0)
    lines.push(`  Objects: ${observation.objects.join(", ")}`);
  if (observation.conditions.length > 0)
    lines.push(`  Conditions: ${observation.conditions.join(", ")}`);
  if (observation.hazards.length > 0)
    lines.push(`  Hazards: ${observation.hazards.join(", ")}`);
  return lines.join("\n");
}
