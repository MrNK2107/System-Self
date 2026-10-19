import express, { type Express, type RequestHandler } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
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

const HEALTH_PATHS = new Set(["/api/healthz", "/api/readyz"]);
/** The RevenueCat webhook is authenticated by its secret and arrives from RevenueCat's few IPs in bursts. */
export const BILLING_WEBHOOK_PATH = "/api/billing/revenuecat";
export const BILLING_WEBHOOK_RATE_LIMIT_MAX = 600;
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

export function createApp(
  deps: { db?: Db | null; mailer?: Mailer; ai?: AiDeps; now?: () => Date; revenuecatSecret?: string | null; trustProxy?: boolean | number; revenuecat?: RevenueCatClient | null; metricsToken?: string | null; logger?: Logger; corsOrigins?: "*" | string[]; timezoneKnown?: TimezoneCheck } = {},
): Express {
  const db = deps.db === undefined ? defaultDb : deps.db;
  const mailer = deps.mailer ?? createMailer();
  const revenuecat =
    deps.revenuecat !== undefined ? deps.revenuecat : env.REVENUECAT_API_KEY ? createRevenueCatClient({ apiKey: env.REVENUECAT_API_KEY }) : null;
  const app: Express = express();
  // Client IPs (and so rate-limit buckets) come from X-Forwarded-For only for trusted proxy hops.
  app.set("trust proxy", deps.trustProxy ?? env.TRUST_PROXY);

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
  app.use(
    rateLimit({
      windowMs: env.RATE_LIMIT_WINDOW_MS,
      max: env.RATE_LIMIT_MAX,
      standardHeaders: true,
      legacyHeaders: false,
      skip: (req) => HEALTH_PATHS.has(req.path) || req.path === BILLING_WEBHOOK_PATH,
    }),
  );
  // Its own generous bucket: RevenueCat retries and bursts (e.g. renewals at the top of the hour) from shared IPs.
  app.use(
    BILLING_WEBHOOK_PATH,
    rateLimit({
      windowMs: 60_000,
      max: BILLING_WEBHOOK_RATE_LIMIT_MAX,
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );
  // One limiter per auth surface so abuse of one (e.g. failed logins) does not lock out the others.
  for (const prefix of ["login", "register", "password", "email"]) {
    app.use(
      `/api/auth/${prefix}`,
      rateLimit({
        windowMs: 15 * 60_000,
        max: 10,
        standardHeaders: true,
        legacyHeaders: false,
        message: { error: "Too many attempts, try again later", code: "rate_limited" },
      }),
    );
  }
  app.use(skipVoice(express.json({ limit: JSON_BODY_LIMIT })));

  app.use("/api", createRouter({ db, mailer, ai: deps.ai, now: deps.now, revenuecatSecret: deps.revenuecatSecret, revenuecat, timezoneKnown: deps.timezoneKnown }));
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
