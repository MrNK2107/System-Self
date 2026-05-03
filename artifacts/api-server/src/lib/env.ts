import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  GEMINI_API_KEY: z.string().min(1).optional(),
  GEMINI_MODEL: z.string().default("gemini-1.5-flash"),
  GEMINI_FALLBACK_MODEL: z.string().default("gemini-1.5-flash-8b"),
  GEMINI_RETRY_COUNT: z.coerce.number().int().min(0).max(5).default(2),
  GEMINI_RETRY_BASE_MS: z.coerce.number().int().min(50).default(250),
  CORS_ORIGIN: z.string().optional(),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(60),
  AUTH_ENABLED: z
    .union([z.literal("true"), z.literal("false")])
    .default("true")
    .transform((v) => v === "true"),
  API_AUTH_TOKENS: z.string().optional(),
});

export const env = envSchema.parse(process.env);

export function resolveCorsOrigins() {
  if (!env.CORS_ORIGIN) {
    return "*";
  }
  return env.CORS_ORIGIN.split(",").map((origin) => origin.trim()).filter(Boolean);
}

export function resolveAuthTokenMap(): Map<string, string> {
  const out = new Map<string, string>();
  if (!env.API_AUTH_TOKENS) return out;
  for (const item of env.API_AUTH_TOKENS.split(",")) {
    const [tokenRaw, usernameRaw] = item.split(":");
    const token = tokenRaw?.trim();
    const username = usernameRaw?.trim();
    if (token && username) out.set(token, username);
  }
  return out;
}
