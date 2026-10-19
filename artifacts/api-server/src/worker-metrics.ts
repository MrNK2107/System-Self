import http from "node:http";
import { Registry } from "prom-client";
import { metricsAuthorized, registry, workerRegistry } from "./lib/metrics";
import { logger } from "./lib/logger";

/**
 * The worker's own tiny /metrics listener (it is a separate process from the API). A listen or socket error
 * (e.g. the port is taken) is logged and never crashes the worker: metrics are optional, rollover is not.
 */
export function startWorkerMetricsServer(
  port: number,
  token: string,
  opts: { onError?: (err: Error) => void } = {},
): http.Server {
  const onError = opts.onError ?? ((err: Error) => logger.error({ err, port }, "Worker metrics listener error"));
  const server = http.createServer(async (req, res) => {
    if (req.method !== "GET" || req.url?.split("?")[0] !== "/metrics") {
      res.writeHead(404).end();
      return;
    }
    if (!metricsAuthorized(req.headers.authorization, token)) {
      res.writeHead(401, { "WWW-Authenticate": "Bearer" }).end();
      return;
    }
    try {
      const merged = Registry.merge([registry, workerRegistry]);
      res.writeHead(200, { "Content-Type": merged.contentType }).end(await merged.metrics());
    } catch (err) {
      onError(err as Error);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    }
  });
  server.on("error", onError);
  server.listen(port);
  server.unref();
  return server;
}

/** Stops accepting connections and drops idle keep-alive sockets; resolves even if the listener never started. */
export function closeWorkerMetricsServer(server: http.Server): Promise<void> {
  return new Promise((resolve) => {
    if (!server.listening) return resolve();
    server.close(() => resolve());
    server.closeIdleConnections();
  });
}
