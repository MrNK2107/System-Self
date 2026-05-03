import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

router.get("/readyz", (_req, res) => {
  const ready = Boolean(process.env.GEMINI_API_KEY);
  if (!ready) {
    return res.status(503).json({ status: "not_ready", reason: "Missing GEMINI_API_KEY" });
  }
  return res.json({ status: "ready" });
});

export default router;
