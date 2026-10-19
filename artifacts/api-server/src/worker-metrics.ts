import http from "node:http";
import { metricsAuthorized, registry } from "./lib/metrics";

/** The worker's own tiny /metrics listener (it is a separate process from the API). */
export function startWorkerMetricsServer(port: number, token: string): http.Server {
  const server = http.createServer(async (req, res) => {
    if (req.method !== "GET" || req.url?.split("?")[0] !== "/metrics") {
      res.writeHead(404).end();
      return;
    }
    if (!metricsAuthorized(req.headers.authorization, token)) {
      res.writeHead(401, { "WWW-Authenticate": "Bearer" }).end();
      return;
    }
    res.writeHead(200, { "Content-Type": registry.contentType }).end(await registry.metrics());
  });
  server.listen(port);
  server.unref();
  return server;
}
