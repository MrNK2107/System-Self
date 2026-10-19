import { Router, type IRouter } from "express";
import type { Db } from "@workspace/db";
import { AdherenceMetricsQuerySchema, type AdherenceMetricsResponse } from "@workspace/contracts";
import { requireAdmin } from "../middlewares/auth";
import { adherenceMetrics } from "../services/adherence-metrics";

// Callers must mount this behind requireAuth.
export function adminMetricsRoutes(db: Db, clock: () => Date = () => new Date()): IRouter {
  const router = Router();

  /** How the adherence features are doing, as counts and ratios over the last `days` days. */
  router.get("/admin/metrics/adherence", requireAdmin, async (req, res) => {
    const { days } = AdherenceMetricsQuerySchema.parse(req.query);
    const body: AdherenceMetricsResponse = await adherenceMetrics(db, clock(), days);
    res.json(body);
  });

  return router;
}
