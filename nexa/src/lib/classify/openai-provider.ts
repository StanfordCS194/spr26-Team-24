import OpenAI from "openai";
import { getOpenAiKey } from "@/lib/config";
import {
  CLASSIFICATION_PROMPT,
  parseClassificationResponse,
  type ProviderResult,
} from "./types";

function getClient() {
  return new OpenAI({ apiKey: getOpenAiKey() });
}

/**
 * Classify a civic issue with OpenAI (gpt-4o-mini).
 *
 * Sends the prompt, optional user `description`, and optional image to the
 * model, then parses the JSON reply into a normalized {@link ProviderResult}
 * tagged with `provider: "openai/gpt-4o-mini"` and the measured `latencyMs`.
 *
 * @param description - User-supplied text describing the issue (skipped when empty).
 * @param imageBase64 - Image as a base64 data URL, or null for text-only.
 * @param options.prompt - Overrides the default `CLASSIFICATION_PROMPT` when set.
 * @returns The model's classification merged with provider id and latency.
 *          Rejects if the OpenAI call throws; callers wrap it in their own
 *          error handling.
 */
export async function classifyWithOpenAI(
  description: string,
  imageBase64: string | null,
  options: { prompt?: string } = {},
): Promise<ProviderResult> {
  const start = Date.now();
  const promptText = options.prompt ?? CLASSIFICATION_PROMPT;

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];

  const content: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
    { type: "text", text: promptText },
  ];

  if (description) {
    content.push({
      type: "text",
      text: `\n\nUser description: "${description}"`,
    });
  }

  if (imageBase64) {
    content.push({
      type: "image_url",
      image_url: { url: imageBase64, detail: "low" },
    });
  }

  messages.push({ role: "user", content });

  const response = await getClient().chat.completions.create({
    model: "gpt-4o-mini",
    messages,
    max_tokens: 300,
    temperature: 0.1,
  });

  const raw = response.choices[0]?.message?.content ?? "{}";
  const parsed = parseClassificationResponse(raw);

  return {
    ...parsed,
    provider: "openai/gpt-4o-mini",
    latencyMs: Date.now() - start,
  };
}
