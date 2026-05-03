import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  GEMINI_API_KEY: z.string().min(1).optional(),
  GEMINI_MODEL: z.string().default("gemini-1.5-flash"),
  CORS_ORIGIN: z.string().optional(),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(60),
});

export const env = envSchema.parse(process.env);

export function resolveCorsOrigins() {
  if (!env.CORS_ORIGIN) {
    return "*";
  }
  return env.CORS_ORIGIN.split(",").map((origin) => origin.trim()).filter(Boolean);
}
