/**
 * Entitlement gate. P5 stub: only an admin can grant PRO (POST /api/admin/users/:id/entitlement). P7 replaces the
 * source with RevenueCat webhooks writing the same `entitlements` row; `isPro` and `requirePro` stay as they are.
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { eq, inArray, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { billingEvents, entitlements, users, type Db } from "@workspace/db";
import { logger } from "../lib/logger";
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

/** SQL twin of isPro for ordering and filtering many users at once: `userIdCol` holds an unexpired `pro` row at `now`. */
export function isProSql(userIdCol: unknown, now: Date): SQL<boolean> {
  return sql<boolean>`exists (select 1 from ${entitlements} e where e.user_id = ${userIdCol} and e.tier = 'pro' and (e.expires_at is null or e.expires_at > ${now.toISOString()}::timestamptz))`;
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
    .values({ userId, tier, source: "admin", expiresAt, productId: null, periodType: null, latestEventAt: null, updatedAt: now })
    .onConflictDoUpdate({ target: entitlements.userId, set: { tier, source: "admin", expiresAt, productId: null, periodType: null, latestEventAt: null, updatedAt: now } })
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
      transferred_from: z.array(z.string()).nullish(),
      transferred_to: z.array(z.string()).nullish(),
    })
    .passthrough(),
  api_version: z.string().optional(),
});
export type RevenueCatEvent = z.infer<typeof RevenueCatWebhookSchema>["event"];

const GRANTING = new Set(["INITIAL_PURCHASE", "RENEWAL", "PRODUCT_CHANGE", "UNCANCELLATION", "SUBSCRIPTION_EXTENDED", "NON_RENEWING_PURCHASE"]);
const KEEPING = new Set(["CANCELLATION", "BILLING_ISSUE"]);

export type RevenueCatOutcome = "replay" | "unknown_user" | "ignored_type" | "stale" | "ignored_admin" | "applied";

/**
 * Applies one webhook event inside a transaction. Idempotent by event id (billing_events). Order-safe: an event older
 * than the entitlement's `latestEventAt` is recorded and ignored, so a late EXPIRATION cannot undo a newer RENEWAL.
 */
export async function applyRevenueCatEvent(db: Db, event: RevenueCatEvent, payload: unknown, now: Date): Promise<RevenueCatOutcome> {
  return db.transaction(async (tx) => {
    const userId = event.app_user_id && isUuid(event.app_user_id) ? event.app_user_id : null;
    const known = userId ? (await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1))[0] : undefined;
    if (!(await recordEvent(tx, event, known ? userId : null, payload, now))) return "replay";
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

    // An unexpired admin grant wins: the event stays recorded and stamps the ordering, but never changes the row.
    if (row && row.source === "admin" && row.tier === "pro" && (row.expiresAt === null || row.expiresAt.getTime() > now.getTime())) {
      await tx.update(entitlements).set({ latestEventAt: eventAt }).where(eq(entitlements.userId, userId));
      return "ignored_admin";
    }

    if (granting) {
      if (!expiry) {
        logger.warn({ event: "revenuecat_grant_without_expiry", userId, eventId: event.id, type: event.type }, "billing_grant_without_expiry");
        return "ignored_type"; // a grant without an expiry would never lapse
      }
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

const isUuid = (v: string) => z.string().uuid().safeParse(v).success;

/**
 * Inserts the billing_events row; false when the id is already there (a replay). A row with no known user keeps only
 * id, type and timestamp: its payload would be personal data with no account to answer for it.
 */
async function recordEvent(tx: Pick<Db, "insert">, event: RevenueCatEvent, userId: string | null, payload: unknown, now: Date): Promise<boolean> {
  const inserted = await tx
    .insert(billingEvents)
    .values({ id: event.id, userId, type: event.type, payload: userId ? (payload as object) : {}, receivedAt: now })
    .onConflictDoNothing()
    .returning({ id: billingEvents.id });
  return inserted.length > 0;
}

// ---- RevenueCat REST (TRANSFER) --------------------------------------------------------------------------------

export const REVENUECAT_API_URL = "https://api.revenuecat.com/v1/subscribers";
export const REVENUECAT_TIMEOUT_MS = 10_000;

/** The `pro` entitlement as RevenueCat holds it now: `expiresAt` null is lifetime, undefined means no entitlement. */
export interface RevenueCatPro {
  expiresAt: Date | null | undefined;
  productId?: string | null;
}
/** Throws when RevenueCat cannot answer (network, timeout, non-2xx, malformed body). */
export interface RevenueCatClient {
  fetchPro(appUserId: string): Promise<RevenueCatPro>;
}

const SubscriberSchema = z.object({
  subscriber: z
    .object({
      entitlements: z.record(
        z.string(),
        z
          .object({ expires_date: z.string().datetime({ offset: true }).nullish(), product_identifier: z.string().nullish() })
          .passthrough(),
      ),
    })
    .passthrough(),
});

/** GET /v1/subscribers/{app_user_id} with the secret API key. The HTTP client is injected so tests never hit the network. */
export function createRevenueCatClient(opts: { apiKey: string; fetch?: typeof fetch; timeoutMs?: number }): RevenueCatClient {
  const doFetch = opts.fetch ?? fetch;
  const timeoutMs = opts.timeoutMs ?? REVENUECAT_TIMEOUT_MS;
  return {
    async fetchPro(appUserId) {
      const res = await doFetch(`${REVENUECAT_API_URL}/${encodeURIComponent(appUserId)}`, {
        method: "GET",
        headers: { Accept: "application/json", Authorization: `Bearer ${opts.apiKey}` },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new Error(`RevenueCat subscribers API answered ${res.status}`);
      const pro = SubscriberSchema.parse(await res.json()).subscriber.entitlements.pro;
      if (!pro) return { expiresAt: undefined };
      return { expiresAt: pro.expires_date == null ? null : new Date(pro.expires_date), productId: pro.product_identifier ?? null };
    },
  };
}

export type RevenueCatTransferOutcome = "replay" | "no_api_key" | "applied";

/**
 * TRANSFER (a restore moved the purchase between app user ids): the event carries no entitlement, so every affected
 * account (`transferred_from` and `transferred_to`, existing users only) is re-fetched from RevenueCat and its row set
 * to what RevenueCat says now. An unexpired admin grant still wins. Fetches happen before anything is recorded, so a
 * RevenueCat failure throws, records nothing and the webhook answers 503 (RevenueCat retries). Without an API key the
 * event is recorded, a warning logged and no entitlement changes.
 */
export async function applyRevenueCatTransfer(
  db: Db,
  event: RevenueCatEvent,
  payload: unknown,
  now: Date,
  client: RevenueCatClient | null,
): Promise<RevenueCatTransferOutcome> {
  const [seen] = await db.select({ id: billingEvents.id }).from(billingEvents).where(eq(billingEvents.id, event.id)).limit(1);
  if (seen) return "replay";
  const candidates = [...new Set([...(event.transferred_from ?? []), ...(event.transferred_to ?? [])])].filter(isUuid);
  const existing = candidates.length
    ? (await db.select({ id: users.id }).from(users).where(inArray(users.id, candidates))).map((u) => u.id)
    : [];
  const ownerId = event.app_user_id && existing.includes(event.app_user_id) ? event.app_user_id : null;
  if (!client) {
    logger.warn(
      { event: "revenuecat_transfer_without_api_key", eventId: event.id, accounts: existing.length },
      "billing_transfer_ignored: set REVENUECAT_API_KEY to apply transfers",
    );
    return (await recordEvent(db, event, ownerId, payload, now)) ? "no_api_key" : "replay";
  }
  const fetched: [string, RevenueCatPro][] = [];
  for (const id of existing) fetched.push([id, await client.fetchPro(id)]);
  const eventAt = new Date(event.event_timestamp_ms ?? now.getTime());
  return db.transaction(async (tx) => {
    if (!(await recordEvent(tx, event, ownerId, payload, now))) return "replay";
    for (const [userId, pro] of fetched) {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}))`);
      const [row] = await tx.select().from(entitlements).where(eq(entitlements.userId, userId)).limit(1);
      const latestEventAt = row?.latestEventAt && row.latestEventAt.getTime() > eventAt.getTime() ? row.latestEventAt : eventAt;
      if (row && row.source === "admin" && row.tier === "pro" && (row.expiresAt === null || row.expiresAt.getTime() > now.getTime())) {
        await tx.update(entitlements).set({ latestEventAt }).where(eq(entitlements.userId, userId));
        continue;
      }
      const active = pro.expiresAt === null || (pro.expiresAt !== undefined && pro.expiresAt.getTime() > now.getTime());
      const values = {
        tier: active ? ("pro" as const) : ("free" as const),
        source: "revenuecat" as const,
        expiresAt: active ? (pro.expiresAt ?? null) : (pro.expiresAt ?? now),
        productId: (active ? pro.productId : null) ?? row?.productId ?? null,
        periodType: row?.periodType ?? null,
        latestEventAt,
        updatedAt: now,
      };
      await tx.insert(entitlements).values({ userId, ...values }).onConflictDoUpdate({ target: entitlements.userId, set: values });
    }
    return "applied";
  });
}

// ---- Retention -------------------------------------------------------------------------------------------------

/** Billing events only guard idempotency (RevenueCat retries for days) and support; kept 180 days. */
export const BILLING_EVENT_TTL_MS = 180 * 86_400_000;

/** Deletes billing_events older than 180 days in bounded batches (at most `maxBatches` per call). Returns the rows deleted. */
export async function pruneBillingEvents(db: Db, now: Date, opts: { batch?: number; maxBatches?: number } = {}): Promise<number> {
  const batch = opts.batch ?? 1000;
  const maxBatches = opts.maxBatches ?? 5;
  const cutoff = new Date(now.getTime() - BILLING_EVENT_TTL_MS);
  let total = 0;
  for (let i = 0; i < maxBatches; i++) {
    const res = await db.execute(
      sql`delete from billing_events where id in (select id from billing_events where received_at < ${cutoff} limit ${batch})`,
    );
    total += res.rowCount ?? 0;
    if ((res.rowCount ?? 0) < batch) break;
  }
  return total;
}

/** The caller's effective entitlement (an expired pro row is free). */
export async function billingStatus(db: Pick<Db, "select">, userId: string, now: Date): Promise<BillingStatus> {
  const [row] = await db.select().from(entitlements).where(eq(entitlements.userId, userId)).limit(1);
  if (!row) return { tier: "free", expiresAt: null, source: null };
  const pro = row.tier === "pro" && (row.expiresAt === null || row.expiresAt.getTime() > now.getTime());
  return { tier: pro ? "pro" : "free", expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null, source: row.source as BillingStatus["source"] };
}
