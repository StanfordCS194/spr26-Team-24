import OpenAI from "openai";

let _openai: OpenAI | null = null;

export function getOpenAI(): OpenAI {
  if (!_openai) {
    _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _openai;
}

export const openai = new Proxy({} as OpenAI, {
  get(_, prop) {
    return (getOpenAI() as Record<string | symbol, unknown>)[prop];
  },
});
