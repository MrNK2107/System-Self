import type { Server } from "node:http";
import { logger } from "./logger";

let shuttingDown = false;

/** True once graceful shutdown began: /readyz answers 503 so load balancers stop routing here. */
export function isShuttingDown(): boolean {
  return shuttingDown;
}

/** Test helper. */
export function resetShuttingDown(): void {
  shuttingDown = false;
}

export interface ShutdownOptions {
  server: Server;
  /** Runs after in-flight requests finished (or the timeout hit); normally `pool.end()`. */
  closePool: () => Promise<unknown>;
  /** Max time to wait for in-flight requests before their sockets are destroyed. */
  timeoutMs?: number;
  /** Pause between flipping readyz to 503 and closing the listener, so a balancer can notice. */
  drainDelayMs?: number;
}

/**
 * Returns a `shutdown(signal)` function: readyz goes 503, the listener stops accepting, in-flight requests
 * finish (idle keep-alive sockets are dropped at once; stragglers are cut at `timeoutMs`), then the pool closes.
 * Calling it again returns the same promise.
 */
export function createShutdown(opts: ShutdownOptions): (signal?: string) => Promise<void> {
  const timeoutMs = opts.timeoutMs ?? 25_000;
  let running: Promise<void> | null = null;
  return (signal = "shutdown") => {
    if (running) return running;
    shuttingDown = true;
    logger.info({ signal }, "Shutting down: draining in-flight requests");
    running = (async () => {
      if (opts.drainDelayMs) await new Promise((r) => setTimeout(r, opts.drainDelayMs));
      const closed = new Promise<void>((resolve) => opts.server.close(() => resolve()));
      opts.server.closeIdleConnections();
      // Keep-alive sockets that go idle after a response during the drain are dropped promptly.
      const idleSweep = setInterval(() => opts.server.closeIdleConnections(), 250);
      idleSweep.unref();
      const timer = setTimeout(() => {
        logger.warn({ timeoutMs }, "Shutdown timeout: closing remaining connections");
        opts.server.closeAllConnections();
      }, timeoutMs);
      timer.unref();
      await closed;
      clearTimeout(timer);
      clearInterval(idleSweep);
      try {
        await opts.closePool();
      } catch (err) {
        logger.error({ err }, "Closing the database pool failed");
      }
      logger.info("Shutdown complete");
    })();
    return running;
  };
}
