import { Router, type IRouter } from "express";
import { sql } from "drizzle-orm";
import { HealthCheckResponse } from "@workspace/api-zod";
import type { Db } from "@workspace/db";
import { aiAvailable } from "../lib/ai";
import { isShuttingDown } from "../lib/shutdown";

export function healthRoutes(db: Db | null): IRouter {
  const router: IRouter = Router();

  router.get("/healthz", (_req, res) => {
    const data = HealthCheckResponse.parse({ status: "ok" });
    res.json(data);
  });

  router.get("/readyz", async (req, res) => {
    if (isShuttingDown()) {
      return res.status(503).json({ status: "shutting_down" });
    }
    if (!db) {
      return res.status(503).json({ status: "not_ready", db: "unavailable" });
    }
    try {
      await db.execute(sql`select 1`);
    } catch (err) {
      req.log.error({ err }, "Readiness check failed");
      return res.status(503).json({ status: "not_ready", db: "error" });
    }
    return res.json({ status: "ready", db: "ok", ai: aiAvailable() ? "gemini" : "template" });
  });

  return router;
}
