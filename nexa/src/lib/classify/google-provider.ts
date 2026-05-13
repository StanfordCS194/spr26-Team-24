import { GoogleGenAI } from "@google/genai";
import {
  CLASSIFICATION_PROMPT,
  type ClassificationResult,
  type ProviderResult,
} from "./types";

function getClient() {
  return new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });
}

function stripPrefix(base64: string): string {
  const idx = base64.indexOf(",");
  return idx >= 0 ? base64.slice(idx + 1) : base64;
}

function extractMimeType(base64: string): string {
  const match = base64.match(/^data:([^;]+);/);
  return match?.[1] ?? "image/jpeg";
}

export async function classifyWithGoogle(
  description: string,
  imageBase64: string | null,
): Promise<ProviderResult> {
  const start = Date.now();

  let textPrompt = CLASSIFICATION_PROMPT;
  if (description) {
    textPrompt += `\n\nUser description: "${description}"`;
  }

  const parts: Array<
    { text: string } | { inlineData: { mimeType: string; data: string } }
  > = [];

  if (imageBase64) {
    parts.push({
      inlineData: {
        mimeType: extractMimeType(imageBase64),
        data: stripPrefix(imageBase64),
      },
    });
  }

  parts.push({ text: textPrompt });

  const response = await getClient().models.generateContent({
    model: "gemini-2.0-flash",
    contents: [{ role: "user", parts }],
  });

  const raw = response.text ?? "{}";
  const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "");
  const parsed = JSON.parse(cleaned) as ClassificationResult;

  return {
    ...parsed,
    provider: "google/gemini-2.0-flash",
    latencyMs: Date.now() - start,
  };
}
