import { z } from "zod";

// Public, insecure secret used only when NODE_ENV is explicitly "development" or "test".
const DEV_JWT_SECRET = "dev-insecure-secret-change-me-0123456789";
// Public placeholder values that must never sign production tokens (keep in sync with .env.example).
const PUBLIC_JWT_SECRETS = new Set([DEV_JWT_SECRET, "dev-only-secret-change-me-at-least-32-characters"]);

/** Values that must never reach production: obvious example/placeholder secrets. */
const PLACEHOLDER = /replace|change|example/i;

const trustProxy = z
  .string()
  .trim()
  .optional()
  .transform((v, ctx): boolean | number => {
    if (v === undefined || v === "" || v === "false") return false;
    if (v === "true") return true;
    if (/^\d+$/.test(v)) return Number(v);
    ctx.addIssue({ code: "custom", message: 'TRUST_PROXY must be "true", "false" or a hop count' });
    return z.NEVER;
  });

/** "1" on, "0" or unset off; anything else is a typo and is refused rather than read as off. */
const flag = (name: string) =>
  z
    .string()
    .trim()
    .optional()
    .transform((v, ctx): boolean => {
      if (v === undefined || v === "" || v === "0") return false;
      if (v === "1") return true;
      ctx.addIssue({ code: "custom", message: `${name} must be "1" or "0"` });
      return z.NEVER;
    });

const envSchema = z.object({
  // No default: an unset NODE_ENV is treated as production-like for secrets and mail.
  NODE_ENV: z.enum(["development", "test", "production"]).optional(),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  GEMINI_API_KEY: z.string().min(1).optional(),
  GEMINI_MODEL: z.string().default("gemini-2.5-flash"),
  GEMINI_FALLBACK_MODEL: z.string().default("gemini-2.5-flash-lite"),
  GEMINI_RETRY_COUNT: z.coerce.number().int().min(0).max(5).default(2),
  GEMINI_RETRY_BASE_MS: z.coerce.number().int().min(50).default(250),
  CORS_ORIGIN: z.string().optional(),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(60),
  TRUST_PROXY: trustProxy,
  /**
   * Load testing only: turns off the per-IP limiters (global, auth, billing webhook), which would otherwise throttle a
   * load generator on one IP. Outside development/test it is refused unless LOAD_TEST=1 is also set, so it cannot be
   * switched on in a real deployment by one stray variable. See docs/PERFORMANCE.md.
   */
  RATE_LIMIT_DISABLED: flag("RATE_LIMIT_DISABLED"),
  /** Marks a production-mode process as a load-test target (the only thing it allows is RATE_LIMIT_DISABLED). */
  LOAD_TEST: flag("LOAD_TEST"),
  MAILER: z.enum(["log", "resend"]).optional(),
  RESEND_API_KEY: z.string().min(1).optional(),
  MAIL_FROM: z.string().min(1).default("SYSTEM // SELF <no-reply@systemself.app>"),
  DATABASE_URL: z.string().min(1).optional(),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters").optional(),
  /**
   * The secret being rotated out. Access tokens verify against JWT_SECRET, then this one; new tokens are always
   * signed with JWT_SECRET. Keep it for one ACCESS_TOKEN_TTL_SEC after a rotation, then remove it.
   */
  JWT_SECRET_PREVIOUS: z.string().min(32, "JWT_SECRET_PREVIOUS must be at least 32 characters").optional(),
  /** Max connections of each process's Postgres pool. */
  DB_POOL_MAX: z.coerce.number().int().min(1).max(500).default(10),
  ACCESS_TOKEN_TTL_SEC: z.coerce.number().int().min(1).default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).default(30),
  WORKER_TICK_MS: z.coerce.number().int().min(1000).default(60_000),
  /** Bearer token of /metrics (guarded against placeholders in production). */
  METRICS_TOKEN: z.string().min(1).optional(),
  /** Port of the worker's own /metrics listener (needs METRICS_TOKEN). Unset: no listener. */
  WORKER_METRICS_PORT: z.coerce.number().int().min(1).max(65535).optional(),
  /** Pause between readyz flipping to 503 and closing the listener. Default 5000 in production, else 0. */
  SHUTDOWN_DRAIN_MS: z.coerce.number().int().min(0).optional(),
  /** Bearer secret of POST /api/billing/revenuecat. Unset: the webhook answers 503 and accepts nothing. */
  REVENUECAT_WEBHOOK_SECRET: z.string().min(1).optional(),
  /**
   * RevenueCat secret REST API key (v1). Needed for TRANSFER events: both accounts are re-fetched from
   * GET /v1/subscribers/{id}. Unset: a TRANSFER is recorded, logged as a warning and changes no entitlement.
   */
  REVENUECAT_API_KEY: z.string().min(1).optional(),
  /** Optional Expo access token (Bearer) for the push API when enhanced push security is on. */
  EXPO_ACCESS_TOKEN: z.string().min(1).optional(),
  /** Wall-clock budget of one social job pass; the rest of its backlog waits for the next tick. */
  SOCIAL_JOB_BUDGET_MS: z.coerce.number().int().min(0).default(2000),
  /** Wall-clock budget of the push decide phase; undecided users wait for the next tick. */
  PUSH_JOB_BUDGET_MS: z.coerce.number().int().min(0).default(15_000),
  /** Wall-clock budget of the push send phase, timed from its own start; batches past it are lost (at most once). */
  PUSH_SEND_BUDGET_MS: z.coerce.number().int().min(0).default(15_000),
});

export type Env = Omit<z.infer<typeof envSchema>, "JWT_SECRET"> & { JWT_SECRET: string };

export function isDevOrTest(nodeEnv: string | undefined): boolean {
  return nodeEnv === "development" || nodeEnv === "test";
}

/** Pure: validates an environment source. Throws a ZodError naming the offending variable. */
export function parseEnv(source: NodeJS.ProcessEnv): Env {
  return envSchema
    .superRefine((v, ctx) => {
      const relaxed = isDevOrTest(v.NODE_ENV);
      if (!relaxed) {
        for (const name of ["REVENUECAT_WEBHOOK_SECRET", "METRICS_TOKEN", "JWT_SECRET_PREVIOUS"] as const) {
          const value = v[name];
          if (value && PLACEHOLDER.test(value)) {
            ctx.addIssue({ code: "custom", path: [name], message: `${name} is a placeholder value` });
          }
        }
        if (v.RATE_LIMIT_DISABLED && !v.LOAD_TEST) {
          ctx.addIssue({
            code: "custom",
            path: ["RATE_LIMIT_DISABLED"],
            message: "RATE_LIMIT_DISABLED is refused outside development/test unless LOAD_TEST=1 (load-test targets only)",
          });
        }
        if (!v.JWT_SECRET) {
          ctx.addIssue({
            code: "custom",
            path: ["JWT_SECRET"],
            message: "JWT_SECRET is required unless NODE_ENV is development or test",
          });
        } else if (PLACEHOLDER.test(v.JWT_SECRET) || PUBLIC_JWT_SECRETS.has(v.JWT_SECRET)) {
          ctx.addIssue({ code: "custom", path: ["JWT_SECRET"], message: "JWT_SECRET is a public placeholder" });
        }
        if (!v.DATABASE_URL) {
          ctx.addIssue({ code: "custom", path: ["DATABASE_URL"], message: "DATABASE_URL is required in production" });
        }
        const origins = splitOrigins(v.CORS_ORIGIN);
        if (origins.length === 0) {
          ctx.addIssue({
            code: "custom",
            path: ["CORS_ORIGIN"],
            message: "CORS_ORIGIN is required in production (comma-separated list of allowed origins)",
          });
        } else if (origins.some((o) => o.includes("*"))) {
          ctx.addIssue({ code: "custom", path: ["CORS_ORIGIN"], message: 'CORS_ORIGIN must not contain "*" in production' });
        }
        if (!v.RESEND_API_KEY && v.MAILER !== "log") {
          ctx.addIssue({
            code: "custom",
            path: ["RESEND_API_KEY"],
            message: "RESEND_API_KEY is required outside development/test (or set MAILER=log explicitly)",
          });
        }
      }
    })
    .transform((v): Env => ({ ...v, JWT_SECRET: v.JWT_SECRET ?? DEV_JWT_SECRET }))
    .parse(source);
}

function splitOrigins(value: string | undefined): string[] {
  return (value ?? "").split(",").map((origin) => origin.trim()).filter(Boolean);
}

/** One line per offending variable, without a stack: what an operator needs to fix the deployment. */
export function formatEnvError(err: unknown): string {
  if (err instanceof z.ZodError) {
    const lines = err.issues.map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`);
    return `Invalid environment:\n${lines.join("\n")}`;
  }
  return `Invalid environment: ${err instanceof Error ? err.message : String(err)}`;
}

function loadEnv(source: NodeJS.ProcessEnv): Env {
  try {
    return parseEnv(source);
  } catch (err) {
    // Boot must fail loudly and readably: a ZodError stack trace hides which variable is wrong.
    process.stderr.write(`${formatEnvError(err)}\n`);
    process.exit(1);
  }
}

export const env = loadEnv(process.env);

/** "*" only when CORS_ORIGIN is unset, which production validation forbids. */
export function resolveCorsOrigins(): "*" | string[] {
  const origins = splitOrigins(env.CORS_ORIGIN);
  return origins.length === 0 ? "*" : origins;
}
