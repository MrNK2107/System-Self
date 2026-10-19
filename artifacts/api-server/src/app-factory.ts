import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { db as defaultDb, type Db } from "@workspace/db";
import { createRouter } from "./routes";
import { logger } from "./lib/logger";
import { env, resolveCorsOrigins } from "./lib/env";
import type { AiDeps } from "./lib/ai";
import { createMailer, type Mailer } from "./lib/mailer";
import { errorHandler, notFoundHandler } from "./middlewares/errors";

const HEALTH_PATHS = new Set(["/api/healthz", "/api/readyz"]);

export function createApp(
  deps: { db?: Db | null; mailer?: Mailer; ai?: AiDeps; now?: () => Date; revenuecatSecret?: string | null; trustProxy?: boolean | number } = {},
): Express {
  const db = deps.db === undefined ? defaultDb : deps.db;
  const mailer = deps.mailer ?? createMailer();
  const app: Express = express();
  // Client IPs (and so rate-limit buckets) come from X-Forwarded-For only for trusted proxy hops.
  app.set("trust proxy", deps.trustProxy ?? env.TRUST_PROXY);

  app.use(
    pinoHttp({
      logger,
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
      skip: (req) => HEALTH_PATHS.has(req.path),
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

  app.use("/api", createRouter({ db, mailer, ai: deps.ai, now: deps.now, revenuecatSecret: deps.revenuecatSecret }));
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
