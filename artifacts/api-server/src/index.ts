import app from "./app";
import { pool } from "@workspace/db";
import { logger } from "./lib/logger";
import { env } from "./lib/env";
import { createShutdown } from "./lib/shutdown";

/** In-flight requests get this long before their sockets are destroyed. */
const HARD_TIMEOUT_MS = 25_000;
/** Process-level backstop, longer than the hard timeout plus the drain delay, in case closing hangs. */
const EXIT_BUDGET_MS = 30_000;

const server = app.listen(env.PORT, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port: env.PORT }, "Server listening");
});

const drainDelayMs = env.SHUTDOWN_DRAIN_MS ?? (env.NODE_ENV === "production" ? 5000 : 0);
const shutdown = createShutdown({
  server,
  closePool: async () => void (await pool?.end()),
  timeoutMs: HARD_TIMEOUT_MS,
  drainDelayMs,
});
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    setTimeout(() => {
      logger.error("Shutdown exceeded its budget, forcing exit");
      process.exit(1);
    }, EXIT_BUDGET_MS + drainDelayMs).unref();
    // Exit naturally once the server and pool are closed; flush the logger first.
    void shutdown(signal).then(() => logger.flush(() => process.exit(0)));
  });
}
