import { createHash, timingSafeEqual } from "node:crypto";
import { Router, type IRouter, type RequestHandler } from "express";
import type { Db } from "@workspace/db";
import { env } from "../lib/env";
import { applyRevenueCatEvent, billingStatus, RevenueCatWebhookSchema } from "../services/entitlements";

/** Constant-time string compare (both sides hashed first so lengths never leak). */
export function secretsMatch(a: string, b: string): boolean {
  return timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());
}

/**
 * `GET /billing/status` (authenticated) and the RevenueCat webhook `POST /billing/revenuecat` (bearer secret, no user
 * auth). With no secret configured (override or env) the webhook is a 503 and accepts nothing.
 */
export function billingRoutes(
  db: Db,
  requireAuth: RequestHandler,
  clock: () => Date = () => new Date(),
  secretOverride?: string | null,
): IRouter {
  const router = Router();

  router.get("/billing/status", requireAuth, async (req, res) => {
    res.json(await billingStatus(db, req.user!.id, clock()));
  });

  router.post("/billing/revenuecat", async (req, res) => {
    const secret = secretOverride === undefined ? env.REVENUECAT_WEBHOOK_SECRET : secretOverride;
    if (!secret) {
      res.status(503).json({ error: "Billing webhook not configured", code: "billing_not_configured" });
      return;
    }
    const header = req.get("authorization") ?? "";
    // RevenueCat sends the configured value verbatim, so both `Bearer <secret>` and the raw `<secret>` are accepted.
    const token = header.startsWith("Bearer ") ? header.slice(7) : header;
    if (!token || !(secretsMatch(token, secret) || secretsMatch(header, secret))) {
      req.log.warn({ event: "revenuecat_auth_failed", hasHeader: header !== "", bearerScheme: header.startsWith("Bearer ") }, "billing_webhook_unauthorized");
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const parsed = RevenueCatWebhookSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid payload", code: "invalid_payload" });
      return;
    }
    const outcome = await applyRevenueCatEvent(db, parsed.data.event, req.body, clock());
    if (outcome === "unknown_user") {
      req.log.warn(
        { event: "revenuecat_unknown_user", eventId: parsed.data.event.id, type: parsed.data.event.type },
        "billing_event_unknown_user",
      );
    }
    res.status(200).json({ ok: true });
  });

  return router;
}
