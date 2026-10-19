import express, { type Express, type Request, type RequestHandler } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import helmet from "helmet";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { db as defaultDb, type Db } from "@workspace/db";
import { createRouter } from "./routes";
import { logger as defaultLogger } from "./lib/logger";
import type { Logger } from "pino";
import { resolveRequestId } from "./lib/request-id";
import { httpMetrics } from "./middlewares/http-metrics";
import { metricsRoutes } from "./routes/metrics";
import { env, resolveCorsOrigins } from "./lib/env";
import type { AiDeps } from "./lib/ai";
import { createMailer, type Mailer } from "./lib/mailer";
import { createRevenueCatClient, type RevenueCatClient } from "./services/entitlements";
import { errorHandler, notFoundHandler } from "./middlewares/errors";
import type { TimezoneCheck } from "./services/timezone";
import { verifyAccessToken } from "./lib/auth/tokens";

const HEALTH_PATHS = new Set(["/api/healthz", "/api/readyz"]);
/** The RevenueCat webhook is authenticated by its secret and arrives from RevenueCat's few IPs in bursts. */
export const BILLING_WEBHOOK_PATH = "/api/billing/revenuecat";
export const BILLING_WEBHOOK_RATE_LIMIT_MAX = 600;
/** Auth surfaces (login, register, password, email codes): per IP + normalised email (or user), per 15 minutes. */
export const AUTH_IDENTITY_RATE_LIMIT_MAX = 10;
/** Looser per-IP ceiling on each auth surface: bounds one IP spraying many emails, yet leaves room for a CGNAT. */
export const AUTH_IP_RATE_LIMIT_MAX = 100;
const AUTH_WINDOW_MS = 15 * 60_000;
const AUTH_PREFIXES = ["login", "register", "password", "email"] as const;
const isAuthLimited = (p: string) => {
  const lower = p.toLowerCase();
  return AUTH_PREFIXES.some((prefix) => lower === `/api/auth/${prefix}` || lower.startsWith(`/api/auth/${prefix}/`));
};
/** JSON body limit (the API is JSON-only). The voice upload route reads its own raw body (5 MB) and is skipped here. */
export const JSON_BODY_LIMIT = "100kb";
const VOICE_UPLOAD_PATH = "/api/logs/voice";

/**
 * With an allowlist, a request whose Origin is not on it is refused outright (403) instead of merely missing CORS
 * headers. Requests without an Origin header (native apps, server-to-server, curl) are not browser cross-origin
 * requests and pass.
 */
function strictOrigin(origins: "*" | string[]): RequestHandler {
  const allowed = origins === "*" ? null : new Set(origins);
  return (req, res, next) => {
    const origin = req.headers.origin;
    if (!allowed || origin === undefined || allowed.has(origin)) return next();
    req.log.info({ event: "cors_origin_rejected", origin: origin.slice(0, 200) }, "cors_rejected");
    res.status(403).json({ error: "Origin not allowed", code: "cors_origin_rejected" });
  };
}

/** Express routing is neither strict nor case-sensitive, so /api/logs/Voice/ reaches the voice route too: skip it as well. */
const isVoiceUpload = (p: string) => {
  const lower = p.toLowerCase();
  return lower === VOICE_UPLOAD_PATH || lower === `${VOICE_UPLOAD_PATH}/`;
};
const skipVoice = (parser: RequestHandler): RequestHandler => (req, res, next) =>
  isVoiceUpload(req.path) ? next() : parser(req, res, next);

function readBearer(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const [scheme, token] = header.split(" ");
  return scheme?.toLowerCase() === "bearer" && token ? token.trim() : null;
}

/**
 * The verified access-token subject, or null when the token is absent, forged or expired (the same check
 * requireAuth runs; an HS256 verify, no database). Memoised per request because several limiters ask.
 */
const subjects = new WeakMap<Request, Promise<string | null>>();
function tokenSubject(req: Request): Promise<string | null> {
  let s = subjects.get(req);
  if (!s) {
    const token = readBearer(req);
    s = token ? verifyAccessToken(token).then((c) => c?.userId ?? null) : Promise.resolve(null);
    subjects.set(req, s);
  }
  return s;
}

const ipKey = (req: Request) => ipKeyGenerator(req.ip ?? "unknown");

export function createApp(
  deps: { db?: Db | null; mailer?: Mailer; ai?: AiDeps; now?: () => Date; revenuecatSecret?: string | null; trustProxy?: boolean | number; revenuecat?: RevenueCatClient | null; metricsToken?: string | null; logger?: Logger; corsOrigins?: "*" | string[]; timezoneKnown?: TimezoneCheck; rateLimitDisabled?: boolean } = {},
): Express {
  const db = deps.db === undefined ? defaultDb : deps.db;
  const mailer = deps.mailer ?? createMailer();
  const revenuecat =
    deps.revenuecat !== undefined ? deps.revenuecat : env.REVENUECAT_API_KEY ? createRevenueCatClient({ apiKey: env.REVENUECAT_API_KEY }) : null;
  const app: Express = express();
  // Client IPs (and so rate-limit buckets) come from X-Forwarded-For only for trusted proxy hops.
  app.set("trust proxy", deps.trustProxy ?? env.TRUST_PROXY);

  // Load-test switch (env guard: production needs LOAD_TEST=1 too). Never on in a real deployment.
  const limitsOff = deps.rateLimitDisabled ?? env.RATE_LIMIT_DISABLED;
  if (limitsOff) (deps.logger ?? defaultLogger).warn({ event: "rate_limits_disabled" }, "Per-IP rate limits are DISABLED (load test)");
  const limiter = (opts: Parameters<typeof rateLimit>[0]): RequestHandler => (limitsOff ? (_req, _res, next) => next() : rateLimit(opts));

  const metricsToken = deps.metricsToken === undefined ? (env.METRICS_TOKEN ?? null) : deps.metricsToken;
  app.use(
    pinoHttp({
      logger: deps.logger ?? defaultLogger,
      genReqId(req, res) {
        const id = resolveRequestId(req.headers["x-request-id"]);
        res.setHeader("x-request-id", id);
        return id;
      },
      serializers: {
        req(req) {
          return {
            id: req.id,
            method: req.method,
            url: req.url?.split("?")[0],
          };
        },
        res(res) {
          return {
            statusCode: res.statusCode,
          };
        },
      },
    }),
  );
  app.use(httpMetrics);
  if (metricsToken) app.use(metricsRoutes(metricsToken));
  app.disable("x-powered-by");
  app.use(helmet());
  const corsOrigins = deps.corsOrigins ?? resolveCorsOrigins();
  app.use(strictOrigin(corsOrigins));
  app.use(
    cors({
      origin: corsOrigins,
    }),
  );
  // Global limiter: per user for a verified access token (many users can share one carrier-grade NAT IP), per IP
  // otherwise. A missing, forged or expired token falls back to the IP, so unauthenticated abuse stays bounded per IP.
  // The auth surfaces have their own limiters below.
  app.use(
    limiter({
      windowMs: env.RATE_LIMIT_WINDOW_MS,
      max: env.RATE_LIMIT_MAX,
      standardHeaders: true,
      legacyHeaders: false,
      keyGenerator: async (req) => {
        const sub = await tokenSubject(req);
        return sub ? `user:${sub}` : `ip:${ipKey(req)}`;
      },
      skip: (req) => HEALTH_PATHS.has(req.path) || req.path === BILLING_WEBHOOK_PATH || isAuthLimited(req.path),
    }),
  );
  // Its own generous bucket: RevenueCat retries and bursts (e.g. renewals at the top of the hour) from shared IPs.
  app.use(
    BILLING_WEBHOOK_PATH,
    limiter({
      windowMs: 60_000,
      max: BILLING_WEBHOOK_RATE_LIMIT_MAX,
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );
  // Two limiters per auth surface (one set per surface, so abuse of one, e.g. failed logins, does not lock out the
  // others). First, before any body parsing, a looser AUTH_IP_RATE_LIMIT_MAX per IP: it bounds one IP spraying many
  // emails, and it also counts requests the JSON parser rejects (malformed or oversized bodies), which would otherwise
  // reach no auth limiter at all (the global limiter skips these routes).
  const authLimited = { error: "Too many attempts, try again later", code: "rate_limited" };
  for (const prefix of AUTH_PREFIXES) {
    app.use(
      `/api/auth/${prefix}`,
      limiter({
        windowMs: AUTH_WINDOW_MS,
        max: AUTH_IP_RATE_LIMIT_MAX,
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator: (req) => `ip:${ipKey(req)}`,
        message: authLimited,
      }),
    );
  }
  app.use(skipVoice(express.json({ limit: JSON_BODY_LIMIT })));
  // Then, after parsing (it keys on the body's email), AUTH_IDENTITY_RATE_LIMIT_MAX per IP + normalised email (or, on
  // the signed-in email/password routes, per IP + user): one account is not brute-forced, and one user behind a shared
  // IP does not lock out the rest.
  for (const prefix of AUTH_PREFIXES) {
    app.use(
      `/api/auth/${prefix}`,
      limiter({
        windowMs: AUTH_WINDOW_MS,
        max: AUTH_IDENTITY_RATE_LIMIT_MAX,
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator: async (req) => {
          const raw = (req.body as { email?: unknown } | undefined)?.email;
          const email = typeof raw === "string" ? raw.trim().toLowerCase().slice(0, 254) : "";
          const who = email ? `email:${email}` : `user:${(await tokenSubject(req)) ?? "-"}`;
          return `ip:${ipKey(req)}|${who}`;
        },
        message: authLimited,
      }),
    );
  }

  app.use("/api", createRouter({ db, mailer, ai: deps.ai, now: deps.now, revenuecatSecret: deps.revenuecatSecret, revenuecat, timezoneKnown: deps.timezoneKnown }));
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
