import { Router, type IRouter } from "express";
import rateLimit from "express-rate-limit";
import type { Db } from "@workspace/db";
import { buildExport } from "../services/export";

export const EXPORT_RATE_LIMIT_MAX = 3;
export const EXPORT_RATE_LIMIT_WINDOW_MS = 60 * 60_000;

/** GET /api/account/export (authed): everything stored about the caller, as a JSON attachment. */
export function accountRoutes(db: Db, now: () => Date = () => new Date()): IRouter {
  const router: IRouter = Router();
  // Per user (this runs after requireAuth), not per IP: a few exports an hour is plenty. In-memory, so per API instance.
  const limiter = rateLimit({
    windowMs: EXPORT_RATE_LIMIT_WINDOW_MS,
    max: EXPORT_RATE_LIMIT_MAX,
    standardHeaders: true,
    legacyHeaders: false,
    // A failed export (5xx or any error response) does not use up the allowance.
    skipFailedRequests: true,
    keyGenerator: (req) => `export:${req.user!.id}`,
    message: { error: "Too many export requests, try again later", code: "rate_limited" },
  });

  router.get("/account/export", limiter, async (req, res) => {
    const at = now();
    const { json, redacted } = await buildExport(db, req.user!.id, at);
    if (redacted > 0) req.log.warn({ event: "export_redacted", redacted }, "export_safety_net");
    req.log.info({ event: "account_export", bytes: Buffer.byteLength(json) }, "account_event");
    res
      .status(200)
      .set({
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="system-self-export-${at.toISOString().slice(0, 10)}.json"`,
        "Cache-Control": "no-store",
      })
      .send(json);
  });

  return router;
}
