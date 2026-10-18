import { GoogleGenAI } from "@google/genai";
import { env } from "./env";

export interface AiCallOptions {
  systemInstruction: string;
  prompt: string;
  maxOutputTokens: number;
  temperature: number;
}

export interface AiCallResult {
  text: string;
  model: string;
  attempts: number;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return (
    msg.includes("429") ||
    msg.includes("503") ||
    msg.includes("500") ||
    msg.toLowerCase().includes("rate") ||
    msg.toLowerCase().includes("timeout") ||
    msg.toLowerCase().includes("unavailable")
  );
}

type ModelCaller = (model: string, options: AiCallOptions) => Promise<string>;

export function aiAvailable(): boolean {
  return Boolean(env.GEMINI_API_KEY);
}

async function callModel(model: string, options: AiCallOptions): Promise<string> {
  if (!env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY must be set.");
  }

  const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  const response = await ai.models.generateContent({
    model,
    contents: options.prompt,
    config: {
      systemInstruction: options.systemInstruction,
      maxOutputTokens: options.maxOutputTokens,
      temperature: options.temperature,
    },
  });
  return (response.text ?? "").trim();
}

/** Without a configured key this resolves with model "template" and empty text; callers substitute a template. */
export async function generateWithFallback(
  options: AiCallOptions,
  call: ModelCaller = callModel,
): Promise<AiCallResult> {
  if (!aiAvailable()) {
    return { text: "", model: "template", attempts: 1 };
  }
  const models = [env.GEMINI_MODEL, env.GEMINI_FALLBACK_MODEL].filter(
    (m, i, arr) => m && arr.indexOf(m) === i,
  );

  let attempts = 0;
  let lastError: unknown = null;

  for (const model of models) {
    for (let retry = 0; retry <= env.GEMINI_RETRY_COUNT; retry++) {
      attempts++;
      try {
        const text = await call(model, options);
        if (!text) {
          throw new Error("Empty model response");
        }
        return { text, model, attempts };
      } catch (error) {
        lastError = error;
        const canRetry = retry < env.GEMINI_RETRY_COUNT && isRetryableError(error);
        if (!canRetry) {
          break;
        }
        const wait = env.GEMINI_RETRY_BASE_MS * 2 ** retry;
        await sleep(wait);
      }
    }
  }

  throw lastError ?? new Error("Model call failed");
}
