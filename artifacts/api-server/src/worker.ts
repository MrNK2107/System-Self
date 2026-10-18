// Rollover worker: rolls every due user over on a fixed tick. Safe to run several instances
// (users are claimed with FOR UPDATE SKIP LOCKED plus a lease).
import { db, pool } from "@workspace/db";
import { env } from "./lib/env";
import { logger } from "./lib/logger";
import { runLoop } from "./jobs/run-loop";

/** Flushes buffered log lines (pino may write asynchronously) before exiting. */
function flushAndExit(code: number): void {
  logger.flush(() => process.exit(code));
}

async function main(): Promise<number> {
  if (!db) {
    logger.fatal("DATABASE_URL is required to run the worker");
    return 1;
  }
  const controller = new AbortController();
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.once(signal, () => {
      logger.info({ signal }, "Worker stopping after the current user");
      controller.abort();
    });
  }
  logger.info({ tickMs: env.WORKER_TICK_MS }, "Worker started");
  await runLoop(db, { tickMs: env.WORKER_TICK_MS, signal: controller.signal });
  await pool?.end();
  logger.info("Worker stopped");
  return 0;
}

main().then(flushAndExit, (err: unknown) => {
  logger.fatal({ err }, "Worker crashed");
  flushAndExit(1);
});
