import pino from "pino";

// An unset NODE_ENV is production-like (consistent with env.ts); pretty output only for development/test.
const isProduction = process.env.NODE_ENV !== "development" && process.env.NODE_ENV !== "test";

/**
 * Secrets that must never reach a log line. `*` matches one level, so `*.headers.authorization` covers req, res, err
 * and any upstream response object. err.config.headers is where HTTP client errors carry the request headers (our
 * outbound calls send Bearer keys to Resend, RevenueCat and Expo). Pino redacts paths, not values: keep secrets in
 * these field names.
 */
export const LOG_REDACT = [
  "req.headers.authorization",
  "req.headers.cookie",
  "res.headers['set-cookie']",
  "*.headers.authorization",
  "*.headers.Authorization",
  "*.headers.cookie",
  "*.headers['set-cookie']",
  "*.apiKey",
  "*.token",
  "*.accessToken",
  "*.refreshToken",
  "err.config.headers",
  "*.err.config.headers",
];

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "test" ? "silent" : "info"),
  redact: LOG_REDACT,
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }),
});
