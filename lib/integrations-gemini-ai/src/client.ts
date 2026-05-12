import { GoogleGenAI } from "@google/genai";

if (!process.env.AI_INTEGRATIONS_GEMINI_BASE_URL) {
  throw new Error(
    "AI_INTEGRATIONS_GEMINI_BASE_URL must be set. Did you forget to provision the Gemini AI integration?",
  );
}

if (!process.env.AI_INTEGRATIONS_GEMINI_API_KEY) {
  throw new Error(
    "AI_INTEGRATIONS_GEMINI_API_KEY must be set. Did you forget to provision the Gemini AI integration?",
  );
}

function getGeminiHttpOptions() {
  const rawBaseUrl = process.env.AI_INTEGRATIONS_GEMINI_BASE_URL!.replace(/\/+$/, "");
  const versionMatch = rawBaseUrl.match(/\/(v1beta|v1)$/);

  return {
    apiVersion: versionMatch?.[1] ?? "v1beta",
    baseUrl: versionMatch ? rawBaseUrl.replace(/\/(v1beta|v1)$/, "") : rawBaseUrl,
  };
}

export const ai = new GoogleGenAI({
  apiKey: process.env.AI_INTEGRATIONS_GEMINI_API_KEY,
  httpOptions: getGeminiHttpOptions(),
});
