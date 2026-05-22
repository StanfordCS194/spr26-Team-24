import OpenAI from "openai";

export interface Observation {
  objects: string[];
  conditions: string[];
  hazards: string[];
  scene: string;
  latencyMs: number;
}

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

function parseObservation(raw: string): Omit<Observation, "latencyMs"> {
  const text = raw
    .trim()
    .replace(/```(?:json)?\s*/gi, "")
    .replace(/```/g, "")
    .trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new SyntaxError("No JSON object in observation response");
  }
  const parsed = JSON.parse(text.slice(start, end + 1));
  return {
    objects: Array.isArray(parsed.objects) ? parsed.objects.map(String) : [],
    conditions: Array.isArray(parsed.conditions)
      ? parsed.conditions.map(String)
      : [],
    hazards: Array.isArray(parsed.hazards) ? parsed.hazards.map(String) : [],
    scene: typeof parsed.scene === "string" ? parsed.scene : "",
  };
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
    content.push({
      type: "text",
      text: `\nUser-supplied description (use only as a hint, do not parrot back): "${description}"`,
    });
  }

  const response = await getClient().chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content }],
    max_tokens: 250,
    temperature: 0.1,
  });

  const raw = response.choices[0]?.message?.content ?? "{}";
  const parsed = parseObservation(raw);
  return { ...parsed, latencyMs: Date.now() - start };
}

/**
 * Render an observation into a compact text block that can be appended to the
 * stage-2 classification prompt. Centralised so all three providers see the
 * same grounding text.
 */
export function renderObservation(observation: Observation | null): string {
  if (!observation) return "";
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
