import Anthropic from "@anthropic-ai/sdk";
import {
  CLASSIFICATION_PROMPT,
  type ClassificationResult,
  type ProviderResult,
} from "./types";

function getClient() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

function extractMediaType(
  base64: string,
): "image/jpeg" | "image/png" | "image/gif" | "image/webp" {
  if (base64.startsWith("data:image/png")) return "image/png";
  if (base64.startsWith("data:image/gif")) return "image/gif";
  if (base64.startsWith("data:image/webp")) return "image/webp";
  return "image/jpeg";
}

function stripPrefix(base64: string): string {
  const idx = base64.indexOf(",");
  return idx >= 0 ? base64.slice(idx + 1) : base64;
}

export async function classifyWithAnthropic(
  description: string,
  imageBase64: string | null,
): Promise<ProviderResult> {
  const start = Date.now();

  const content: Anthropic.Messages.ContentBlockParam[] = [];

  if (imageBase64) {
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: extractMediaType(imageBase64),
        data: stripPrefix(imageBase64),
      },
    });
  }

  let textPrompt = CLASSIFICATION_PROMPT;
  if (description) {
    textPrompt += `\n\nUser description: "${description}"`;
  }
  content.push({ type: "text", text: textPrompt });

  const response = await getClient().messages.create({
    model: "claude-3-5-haiku-20241022",
    max_tokens: 300,
    messages: [{ role: "user", content }],
  });

  const raw =
    response.content[0]?.type === "text" ? response.content[0].text : "{}";
  const parsed = JSON.parse(raw) as ClassificationResult;

  return {
    ...parsed,
    provider: "anthropic/claude-3.5-haiku",
    latencyMs: Date.now() - start,
  };
}
