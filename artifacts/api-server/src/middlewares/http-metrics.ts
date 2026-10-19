import type { RequestHandler } from "express";
import { httpRequestDuration } from "../lib/metrics";

const EXCLUDED = new Set(["/metrics", "/api/healthz", "/api/readyz"]);

/** Times every request into http_request_duration_seconds, labelled by the matched route pattern. */
export const httpMetrics: RequestHandler = (req, res, next) => {
  const end = httpRequestDuration.startTimer();
  res.on("finish", () => {
    if (EXCLUDED.has(req.originalUrl.split("?")[0] ?? "")) return;
    const route = req.route?.path !== undefined ? `${req.baseUrl}${String(req.route.path)}` : "unmatched";
    end({ method: req.method, route, status: String(res.statusCode) });
  });
  next();
};
