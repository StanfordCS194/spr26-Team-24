import OpenAI from "openai";
import { getOpenAiKey } from "@/lib/config";

export function getOpenAI(): OpenAI {
  return new OpenAI({ apiKey: getOpenAiKey() });
}
