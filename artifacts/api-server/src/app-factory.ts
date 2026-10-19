import express, { type Express } from "express";
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

const HEALTH_PATHS = new Set(["/api/healthz", "/api/readyz"]);
/** The RevenueCat webhook is authenticated by its secret and arrives from RevenueCat's few IPs in bursts. */
export const BILLING_WEBHOOK_PATH = "/api/billing/revenuecat";
export const BILLING_WEBHOOK_RATE_LIMIT_MAX = 600;

export function createApp(
  deps: { db?: Db | null; mailer?: Mailer; ai?: AiDeps; now?: () => Date; revenuecatSecret?: string | null; trustProxy?: boolean | number; revenuecat?: RevenueCatClient | null; metricsToken?: string | null; logger?: Logger } = {},
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
  app.use(
    cors({
      origin: resolveCorsOrigins(),
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
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  app.use("/api", createRouter({ db, mailer, ai: deps.ai, now: deps.now, revenuecatSecret: deps.revenuecatSecret, revenuecat }));
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
