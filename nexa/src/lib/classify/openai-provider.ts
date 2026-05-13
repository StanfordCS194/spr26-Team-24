import OpenAI from "openai";
import {
  CLASSIFICATION_PROMPT,
  type ClassificationResult,
  type ProviderResult,
} from "./types";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function classifyWithOpenAI(
  description: string,
  imageBase64: string | null,
): Promise<ProviderResult> {
  const start = Date.now();

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];

  const content: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
    { type: "text", text: CLASSIFICATION_PROMPT },
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

  const response = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages,
    max_tokens: 300,
    temperature: 0.1,
  });

  const raw = response.choices[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(raw) as ClassificationResult;

  return {
    ...parsed,
    provider: "openai/gpt-4o-mini",
    latencyMs: Date.now() - start,
  };
}
