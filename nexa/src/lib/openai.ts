import OpenAI from "openai";

export function getOpenAI(): OpenAI {
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}
