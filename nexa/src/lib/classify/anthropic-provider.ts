import Anthropic from "@anthropic-ai/sdk";
import { getAnthropicKey } from "@/lib/config";
import { DEFAULT_LLM_TIMEOUT_MS } from "@/lib/http";
import { stripDataUrlPrefix } from "./image-utils";
import {
  CLASSIFICATION_PROMPT,
  formatUserDescription,
  parseClassificationResponse,
  type ProviderResult,
} from "./types";

function getClient() {
  return new Anthropic({ apiKey: getAnthropicKey() });
}

function extractMediaType(
  base64: string,
): "image/jpeg" | "image/png" | "image/gif" | "image/webp" {
  if (base64.startsWith("data:image/png")) return "image/png";
  if (base64.startsWith("data:image/gif")) return "image/gif";
  if (base64.startsWith("data:image/webp")) return "image/webp";
  return "image/jpeg";
}

/**
 * Classify a civic issue with Anthropic (claude-haiku-4-5).
 *
 * Sends the prompt, optional user `description`, and optional image to the
 * model, then parses the JSON reply into a normalized {@link ProviderResult}
 * tagged with `provider: "anthropic/claude-haiku-4-5"` and the measured
 * `latencyMs`.
 *
 * @param description - User-supplied text describing the issue (skipped when empty).
 * @param imageBase64 - Image as a base64 data URL, or null for text-only.
 * @param options.prompt - Overrides the default `CLASSIFICATION_PROMPT` when set.
 * @returns The model's classification merged with provider id and latency.
 *          Rejects if the Anthropic call throws; callers wrap it in their own
 *          error handling.
 */
export async function classifyWithAnthropic(
  description: string,
  imageBase64: string | null,
  options: { prompt?: string } = {},
): Promise<ProviderResult> {
  const start = Date.now();

  const content: Anthropic.Messages.ContentBlockParam[] = [];

  if (imageBase64) {
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: extractMediaType(imageBase64),
        data: stripDataUrlPrefix(imageBase64),
      },
    });
  }

  let textPrompt = options.prompt ?? CLASSIFICATION_PROMPT;
  const descriptionBlock = formatUserDescription(description);
  if (descriptionBlock) {
    textPrompt += `\n\n${descriptionBlock}`;
  }
  content.push({ type: "text", text: textPrompt });

  const response = await getClient().messages.create(
    {
      model: "claude-haiku-4-5",
      max_tokens: 300,
      messages: [{ role: "user", content }],
    },
    { timeout: DEFAULT_LLM_TIMEOUT_MS },
  );

  const raw =
    response.content[0]?.type === "text" ? response.content[0].text : "{}";
  const parsed = parseClassificationResponse(raw);

  return {
    ...parsed,
    provider: "anthropic/claude-haiku-4-5",
    latencyMs: Date.now() - start,
  };
}
