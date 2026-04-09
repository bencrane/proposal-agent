import OpenAI from "openai";
import { getEnv } from "../config/env";

let _client: OpenAI | null = null;

export function getOpenAI(): OpenAI {
  if (!_client) {
    const env = getEnv();
    if (!env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY not configured");
    }
    _client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  }
  return _client;
}
