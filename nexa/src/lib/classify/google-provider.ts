import { GoogleGenAI } from "@google/genai";
import { getGoogleApiKey } from "@/lib/config";
import { DEFAULT_LLM_TIMEOUT_MS } from "@/lib/http";
import { stripDataUrlPrefix } from "./image-utils";
import {
  CLASSIFICATION_PROMPT,
  formatUserDescription,
  parseClassificationResponse,
  type ProviderResult,
} from "./types";

function getClient() {
  return new GoogleGenAI({ apiKey: getGoogleApiKey() });
}

function extractMimeType(base64: string): string {
  const match = base64.match(/^data:([^;]+);/);
  return match?.[1] ?? "image/jpeg";
}

/**
 * Classify a civic issue with Google (gemini-2.5-flash).
 *
 * Sends the prompt, optional user `description`, and optional image to the
 * model, then parses the JSON reply into a normalized {@link ProviderResult}
 * tagged with `provider: "google/gemini-2.5-flash"` and the measured
 * `latencyMs`.
 *
 * @param description - User-supplied text describing the issue (skipped when empty).
 * @param imageBase64 - Image as a base64 data URL, or null for text-only.
 * @param options.prompt - Overrides the default `CLASSIFICATION_PROMPT` when set.
 * @returns The model's classification merged with provider id and latency.
 *          Rejects if the Google call throws; callers wrap it in their own
 *          error handling.
 */
export async function classifyWithGoogle(
  description: string,
  imageBase64: string | null,
  options: { prompt?: string } = {},
): Promise<ProviderResult> {
  const start = Date.now();

  let textPrompt = options.prompt ?? CLASSIFICATION_PROMPT;
  const descriptionBlock = formatUserDescription(description);
  if (descriptionBlock) {
    textPrompt += `\n\n${descriptionBlock}`;
  }

  const parts: Array<
    { text: string } | { inlineData: { mimeType: string; data: string } }
  > = [];

  if (imageBase64) {
    parts.push({
      inlineData: {
        mimeType: extractMimeType(imageBase64),
        data: stripDataUrlPrefix(imageBase64),
      },
    });
  }

  parts.push({ text: textPrompt });

  const response = await getClient().models.generateContent({
    model: "gemini-2.5-flash",
    contents: [{ role: "user", parts }],
    config: { httpOptions: { timeout: DEFAULT_LLM_TIMEOUT_MS } },
  });

  const raw = response.text ?? "{}";
  const parsed = parseClassificationResponse(raw);

  return {
    ...parsed,
    provider: "google/gemini-2.5-flash",
    latencyMs: Date.now() - start,
  };
}
