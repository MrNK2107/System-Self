import { Router, type IRouter } from "express";
import { metricsAuthorized, registry } from "../lib/metrics";

/** GET /metrics, Bearer-protected. The caller mounts it only when a token is configured (else 404). */
export function metricsRoutes(token: string): IRouter {
  const router: IRouter = Router();
  router.get("/metrics", async (req, res) => {
    if (!metricsAuthorized(req.headers.authorization, token)) {
      return res.status(401).set("WWW-Authenticate", "Bearer").json({ error: "Unauthorized" });
    }
    res.set("Content-Type", registry.contentType);
    return res.send(await registry.metrics());
  });
  return router;
}
