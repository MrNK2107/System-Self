import pino from "pino";

// An unset NODE_ENV is production-like (consistent with env.ts); pretty output only for development/test.
const isProduction = process.env.NODE_ENV !== "development" && process.env.NODE_ENV !== "test";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "test" ? "silent" : "info"),
  redact: [
    "req.headers.authorization",
    "req.headers.cookie",
    "res.headers['set-cookie']",
  ],
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }),
});
