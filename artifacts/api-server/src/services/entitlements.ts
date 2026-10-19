/**
 * Entitlement gate. P5 stub: only an admin can grant PRO (POST /api/admin/users/:id/entitlement). P7 replaces the
 * source with RevenueCat webhooks writing the same `entitlements` row; `isPro` and `requirePro` stay as they are.
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { billingEvents, entitlements, users, type Db } from "@workspace/db";
import { PRO_REQUIRED_CODE, type BillingStatus } from "@workspace/contracts";

/** True when the user holds a `pro` row that has not expired at `now` (the expiry instant itself is expired). */
export async function isPro(db: Pick<Db, "select">, userId: string, now: Date): Promise<boolean> {
  const [row] = await db
    .select({ tier: entitlements.tier, expiresAt: entitlements.expiresAt })
    .from(entitlements)
    .where(eq(entitlements.userId, userId))
    .limit(1);
  if (!row || row.tier !== "pro") return false;
  return row.expiresAt === null || row.expiresAt.getTime() > now.getTime();
}

/** Sets (or replaces) a user's tier from an admin grant. */
export async function grantEntitlement(
  db: Pick<Db, "insert">,
  userId: string,
  tier: "free" | "pro",
  expiresAt: Date | null,
  now: Date,
) {
  const [row] = await db
    .insert(entitlements)
    .values({ userId, tier, source: "admin", expiresAt, updatedAt: now })
    .onConflictDoUpdate({ target: entitlements.userId, set: { tier, source: "admin", expiresAt, updatedAt: now } })
    .returning();
  return row!;
}

/** The 402 answer of a PRO-only request (also the body requirePro sends). */
export const proRequiredResult = () => ({ status: 402, body: { error: "PRO required", code: PRO_REQUIRED_CODE } });

/**
 * Inside withIdempotency, after the replay lookup: a replay of a request that succeeded while the user held PRO still
 * answers with its stored result once PRO lapses; only new work needs PRO. Mutating PRO routes use this, not requirePro.
 */
export async function proRequiredUnlessPro(db: Pick<Db, "select">, userId: string, now: Date) {
  return (await isPro(db, userId, now)) ? null : proRequiredResult();
}

/** Route guard for PRO features: 402 `{ code: "pro_required" }` for everyone else. Mount after requireAuth. */
export function requirePro(db: Pick<Db, "select">, clock: () => Date = () => new Date()): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      if (!(await isPro(db, req.user.id, clock()))) {
        res.status(402).json({ error: "PRO required", code: PRO_REQUIRED_CODE });
        return;
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

// ---- RevenueCat ------------------------------------------------------------------------------------------------

export const RevenueCatWebhookSchema = z.object({
  event: z
    .object({
      id: z.string().min(1),
      type: z.string().min(1),
      app_user_id: z.string().optional(),
      event_timestamp_ms: z.number().finite().optional(),
      expiration_at_ms: z.number().finite().nullish(),
      product_id: z.string().nullish(),
      period_type: z.string().nullish(),
    })
    .passthrough(),
  api_version: z.string().optional(),
});
export type RevenueCatEvent = z.infer<typeof RevenueCatWebhookSchema>["event"];

const GRANTING = new Set(["INITIAL_PURCHASE", "RENEWAL", "PRODUCT_CHANGE", "UNCANCELLATION"]);
const KEEPING = new Set(["CANCELLATION", "BILLING_ISSUE"]);

export type RevenueCatOutcome = "replay" | "unknown_user" | "ignored_type" | "stale" | "applied";

/**
 * Applies one webhook event inside a transaction. Idempotent by event id (billing_events). Order-safe: an event older
 * than the entitlement's `latestEventAt` is recorded and ignored, so a late EXPIRATION cannot undo a newer RENEWAL.
 */
export async function applyRevenueCatEvent(db: Db, event: RevenueCatEvent, payload: unknown, now: Date): Promise<RevenueCatOutcome> {
  return db.transaction(async (tx) => {
    const userId = event.app_user_id && z.string().uuid().safeParse(event.app_user_id).success ? event.app_user_id : null;
    const known = userId ? (await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1))[0] : undefined;
    const inserted = await tx
      .insert(billingEvents)
      .values({ id: event.id, userId: known ? userId : null, type: event.type, payload: payload as object, receivedAt: now })
      .onConflictDoNothing()
      .returning({ id: billingEvents.id });
    if (inserted.length === 0) return "replay";
    if (!known || !userId) return "unknown_user";
    const granting = GRANTING.has(event.type);
    const keeping = KEEPING.has(event.type);
    if (!granting && !keeping && event.type !== "EXPIRATION") return "ignored_type";

    // Serialise concurrent events of one user so the timestamp comparison below is race-free.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}))`);
    const [row] = await tx.select().from(entitlements).where(eq(entitlements.userId, userId)).limit(1);
    const eventAt = new Date(event.event_timestamp_ms ?? now.getTime());
    if (row?.latestEventAt && eventAt.getTime() < row.latestEventAt.getTime()) return "stale";
    const expiry = event.expiration_at_ms != null ? new Date(event.expiration_at_ms) : null;

    if (granting) {
      if (!expiry) return "ignored_type"; // a grant without an expiry would never lapse
      await tx
        .insert(entitlements)
        .values({ userId, tier: "pro", source: "revenuecat", expiresAt: expiry, productId: event.product_id ?? null, periodType: event.period_type ?? null, latestEventAt: eventAt, updatedAt: now })
        .onConflictDoUpdate({
          target: entitlements.userId,
          set: { tier: "pro", source: "revenuecat", expiresAt: expiry, productId: event.product_id ?? null, periodType: event.period_type ?? null, latestEventAt: eventAt, updatedAt: now },
        });
      return "applied";
    }
    if (keeping) {
      // Access continues until the period ends: only the ordering stamp (and a newer expiry, if sent) changes.
      if (!row || row.source !== "revenuecat") return "ignored_type";
      await tx
        .update(entitlements)
        .set({ latestEventAt: eventAt, updatedAt: now, ...(expiry ? { expiresAt: expiry } : {}) })
        .where(eq(entitlements.userId, userId));
      return "applied";
    }
    // EXPIRATION
    await tx
      .insert(entitlements)
      .values({ userId, tier: "free", source: "revenuecat", expiresAt: expiry ?? eventAt, productId: event.product_id ?? null, periodType: event.period_type ?? null, latestEventAt: eventAt, updatedAt: now })
      .onConflictDoUpdate({
        target: entitlements.userId,
        set: { tier: "free", source: "revenuecat", expiresAt: expiry ?? eventAt, latestEventAt: eventAt, updatedAt: now },
      });
    return "applied";
  });
}

/** The caller's effective entitlement (an expired pro row is free). */
export async function billingStatus(db: Pick<Db, "select">, userId: string, now: Date): Promise<BillingStatus> {
  const [row] = await db.select().from(entitlements).where(eq(entitlements.userId, userId)).limit(1);
  if (!row) return { tier: "free", expiresAt: null, source: null };
  const pro = row.tier === "pro" && (row.expiresAt === null || row.expiresAt.getTime() > now.getTime());
  return { tier: pro ? "pro" : "free", expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null, source: row.source as BillingStatus["source"] };
}
