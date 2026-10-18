import { z } from "zod";

const DEV_JWT_SECRET = "dev-insecure-secret-change-me-0123456789";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  GEMINI_API_KEY: z.string().min(1).optional(),
  GEMINI_MODEL: z.string().default("gemini-2.5-flash"),
  GEMINI_FALLBACK_MODEL: z.string().default("gemini-2.5-flash-lite"),
  GEMINI_RETRY_COUNT: z.coerce.number().int().min(0).max(5).default(2),
  GEMINI_RETRY_BASE_MS: z.coerce.number().int().min(50).default(250),
  CORS_ORIGIN: z.string().optional(),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(60),
  RESEND_API_KEY: z.string().min(1).optional(),
  MAIL_FROM: z.string().min(1).default("SYSTEM // SELF <no-reply@systemself.app>"),
  DATABASE_URL: z.string().min(1).optional(),
  JWT_SECRET: z.string().min(32).default(DEV_JWT_SECRET),
  ACCESS_TOKEN_TTL_SEC: z.coerce.number().int().min(1).default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).default(30),
}).superRefine((v, ctx) => {
  if (v.NODE_ENV === "production" && v.JWT_SECRET === DEV_JWT_SECRET) {
    ctx.addIssue({ code: "custom", path: ["JWT_SECRET"], message: "JWT_SECRET must be set in production" });
  }
});

export const env = envSchema.parse(process.env);

export function resolveCorsOrigins() {
  if (!env.CORS_ORIGIN) {
    return "*";
  }
  return env.CORS_ORIGIN.split(",").map((origin) => origin.trim()).filter(Boolean);
}
