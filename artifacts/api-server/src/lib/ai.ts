import { GoogleGenAI } from "@google/genai";
import { env } from "./env";
import { logger } from "./logger";
import { aiCalls, aiFallbacks, type AiOutcome } from "./metrics";

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

class EmptyModelResponse extends Error {
  constructor() {
    super("Empty model response");
  }
}

function outcomeOf(error: unknown): AiOutcome {
  if (error instanceof EmptyModelResponse) return "invalid";
  const name = error instanceof Error ? error.name : "";
  const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return name === "AbortError" || name === "TimeoutError" || msg.includes("timeout") || msg.includes("timed out") ? "timeout" : "error";
}

export type ModelCaller = (model: string, options: AiCallOptions) => Promise<string>;

/** The audio of a voice log, sent inline to the model. It lives in memory for the request only. */
export interface AudioInput {
  data: Buffer;
  mimeType: string;
}

export type AudioModelCaller = (model: string, options: AiCallOptions, audio: AudioInput) => Promise<string>;

/** Injectable AI dependency (tests pass a fake model; production leaves it unset for Gemini). */
export interface AiDeps {
  call?: ModelCaller;
  /** Audio-input model call (voice logs). */
  audio?: AudioModelCaller;
}

export type AiProvider = "ollama" | "gemini" | "template";

/** A local Ollama model wins when configured; otherwise Gemini with a key; otherwise templates. */
export function aiProvider(): AiProvider {
  if (env.OLLAMA_MODEL) return "ollama";
  return env.GEMINI_API_KEY ? "gemini" : "template";
}

export function aiAvailable(): boolean {
  return aiProvider() !== "template";
}

/** Audio input (voice logs) needs Gemini: the Ollama path is text only. */
export function audioAvailable(): boolean {
  return Boolean(env.GEMINI_API_KEY);
}

async function callOllama(model: string, options: AiCallOptions): Promise<string> {
  const res = await fetch(`${env.OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    signal: AbortSignal.timeout(env.OLLAMA_TIMEOUT_MS),
    body: JSON.stringify({
      model,
      stream: false,
      // Gemma 4 can think first; the replies here are short and the budget is maxOutputTokens, so it answers directly.
      think: false,
      keep_alive: -1,
      messages: [
        { role: "system", content: options.systemInstruction },
        { role: "user", content: options.prompt },
      ],
      options: { num_predict: options.maxOutputTokens, temperature: options.temperature, num_ctx: env.OLLAMA_NUM_CTX },
    }),
  });
  if (!res.ok) {
    throw new Error(`Ollama ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const body = (await res.json()) as { message?: { content?: string } };
  return (body.message?.content ?? "").trim();
}

async function callModel(model: string, options: AiCallOptions): Promise<string> {
  if (aiProvider() === "ollama") return callOllama(model, options);
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

async function callAudioModel(model: string, options: AiCallOptions, audio: AudioInput): Promise<string> {
  if (!env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY must be set.");
  }
  const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  const response = await ai.models.generateContent({
    model,
    contents: [
      {
        role: "user",
        parts: [{ text: options.prompt }, { inlineData: { mimeType: audio.mimeType, data: audio.data.toString("base64") } }],
      },
    ],
    config: {
      systemInstruction: options.systemInstruction,
      maxOutputTokens: options.maxOutputTokens,
      temperature: options.temperature,
    },
  });
  return (response.text ?? "").trim();
}

/** Without a configured key this resolves with model "template" and empty text; callers substitute a template. */
export function generateWithFallback(options: AiCallOptions, call: ModelCaller = callModel): Promise<AiCallResult> {
  if (aiProvider() === "ollama") return runModels([env.OLLAMA_MODEL!], options, call);
  return runModels(env.GEMINI_API_KEY ? [env.GEMINI_MODEL, env.GEMINI_FALLBACK_MODEL] : [], options, call);
}

async function runModels(candidates: string[], options: AiCallOptions, call: ModelCaller): Promise<AiCallResult> {
  if (candidates.length === 0) {
    return { text: "", model: "template", attempts: 1 };
  }
  const models = candidates.filter((m, i, arr) => m && arr.indexOf(m) === i);

  let attempts = 0;
  let lastError: unknown = null;

  for (const model of models) {
    for (let retry = 0; retry <= env.GEMINI_RETRY_COUNT; retry++) {
      attempts++;
      try {
        const text = await call(model, options);
        if (!text) {
          throw new EmptyModelResponse();
        }
        aiCalls.inc({ model, outcome: "ok" });
        return { text, model, attempts };
      } catch (error) {
        lastError = error;
        aiCalls.inc({ model, outcome: outcomeOf(error) });
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

/**
 * Like generateWithFallback, but never throws: when Gemini still fails after retries and the
 * fallback model, logs a warning and resolves with model "template" so callers substitute a template.
 */
export async function generateOrTemplate(
  options: AiCallOptions,
  call: ModelCaller = callModel,
): Promise<AiCallResult> {
  try {
    const result = await generateWithFallback(options, call);
    if (result.model === "template") aiFallbacks.inc();
    return result;
  } catch (error) {
    aiFallbacks.inc();
    logger.warn({ err: error instanceof Error ? error.message : String(error) }, "AI generation failed; using template");
    return { text: "", model: "template", attempts: env.GEMINI_RETRY_COUNT + 1 };
  }
}

/**
 * Audio input through the same model order, retries and fallback as text. Throws when every attempt fails.
 * Without a key it resolves with model "template" and empty text, like generateWithFallback: voice callers check
 * audioAvailable first and answer 503 ai_unavailable.
 */
export function generateFromAudio(
  options: AiCallOptions,
  audio: AudioInput,
  call: AudioModelCaller = callAudioModel,
): Promise<AiCallResult> {
  // Always the Gemini models, even when Ollama answers text: the local path has no audio input.
  return runModels(audioAvailable() ? [env.GEMINI_MODEL, env.GEMINI_FALLBACK_MODEL] : [], options, (model, o) =>
    call(model, o, audio),
  );
}
