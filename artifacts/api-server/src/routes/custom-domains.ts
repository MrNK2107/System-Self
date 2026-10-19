import { Router, type IRouter } from "express";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { customDomains, customLogs, users, type CustomDomainRow, type Db } from "@workspace/db";
import { applyCustomLog, customStreakNow, localDate } from "@workspace/engine";
import {
  CUSTOM_LIMIT_CODE,
  CustomDomainCreateSchema,
  CustomDomainUpdateSchema,
  CustomLogRequestSchema,
  type CustomDomainList,
  type CustomLogResponse,
} from "@workspace/contracts";
import { activeCustomCount, customDomainDetail, customLimit, latestValues, toCustomDomainDto, userToday } from "../services/custom-domains";
import { isPro, proRequiredResult } from "../services/entitlements";
import { withIdempotency } from "../services/idempotency";
import { checkOccurredAt } from "../services/retroactive";
import type { Tx } from "../services/user-lock";

// CUSTOM domains (PRD 8): user-defined stats with a separate 0-100 score. RULING: a custom log is NOT ranked activity.
// It never goes through applyActivityChanges / applyChanges, so it writes no score_events and never touches the five
// ranked domain scores, lastActivityDate, comebacks, decay protection, rank, the hidden score, shadow, rivals or
// challenges. Its streak and score live on the custom domain row alone.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOT_FOUND = { status: 404, body: { error: "Custom domain not found", code: "not_found" } };
const ARCHIVED = { status: 409, body: { error: "The custom domain is archived", code: "archived" } };
const NAME_TAKEN = { status: 409, body: { error: "You already have a custom domain with that name", code: "name_taken" } };

/** The user's own domain (archived or not) by id; null for a bad id or another user's. */
async function ownDomain(tx: Pick<Tx, "select">, userId: string, id: string): Promise<CustomDomainRow | null> {
  if (!UUID.test(id)) return null;
  const [row] = await tx
    .select()
    .from(customDomains)
    .where(and(eq(customDomains.id, id), eq(customDomains.userId, userId)))
    .limit(1);
  return row ?? null;
}

async function nameInUse(tx: Pick<Tx, "select">, userId: string, name: string, exceptId?: string): Promise<boolean> {
  const rows = await tx
    .select({ id: customDomains.id })
    .from(customDomains)
    .where(and(eq(customDomains.userId, userId), isNull(customDomains.archivedAt), sql`lower(${customDomains.name}) = lower(${name})`));
  return rows.some((r) => r.id !== exceptId);
}

export function customDomainsRoutes(db: Db, clock: () => Date = () => new Date()): IRouter {
  const router = Router();

  router.get("/custom-domains", async (req, res) => {
    const userId = req.user!.id;
    const now = clock();
    const rows = await db
      .select()
      .from(customDomains)
      .where(and(eq(customDomains.userId, userId), isNull(customDomains.archivedAt)))
      .orderBy(asc(customDomains.createdAt), asc(customDomains.id));
    const latest = await latestValues(db, rows.map((r) => r.id));
    const today = await userToday(db, userId, now);
    const pro = await isPro(db, userId, now);
    const body: CustomDomainList = {
      items: rows.map((r) => toCustomDomainDto(r, latest.get(r.id) ?? null, today)),
      limit: customLimit(pro),
      isPro: pro,
    };
    res.json(body);
  });

  router.get("/custom-domains/:id", async (req, res) => {
    const row = await ownDomain(db, req.user!.id, String(req.params.id));
    if (!row) {
      res.status(NOT_FOUND.status).json(NOT_FOUND.body);
      return;
    }
    res.json(await customDomainDetail(db, row, clock()));
  });

  router.post("/custom-domains", async (req, res) => {
    const body = CustomDomainCreateSchema.parse(req.body);
    const userId = req.user!.id;
    await withIdempotency(db, req, res, "POST /custom-domains", async (tx) => {
      const now = clock();
      const active = await activeCustomCount(tx, userId);
      if (active >= customLimit(true)) {
        return { status: 409, body: { error: "Custom domain limit reached", code: CUSTOM_LIMIT_CODE } };
      }
      if (active >= customLimit(false) && !(await isPro(tx, userId, now))) return proRequiredResult();
      if (await nameInUse(tx, userId, body.name)) return NAME_TAKEN;
      const [row] = await tx
        .insert(customDomains)
        .values({
          userId,
          name: body.name,
          unit: body.unit,
          logLabel: body.logLabel,
          baseline: body.baseline,
          target: body.target,
          isPublic: body.isPublic,
        })
        .returning();
      return { status: 201, body: await customDomainDetail(tx, row!, now) };
    });
  });

  router.patch("/custom-domains/:id", async (req, res) => {
    const id = String(req.params.id);
    const { clientId: _clientId, ...patch } = CustomDomainUpdateSchema.parse(req.body);
    const userId = req.user!.id;
    await withIdempotency(db, req, res, `PATCH /custom-domains/${id}`, async (tx) => {
      const row = await ownDomain(tx, userId, id);
      if (!row) return NOT_FOUND;
      if (row.archivedAt) return ARCHIVED;
      if (patch.name !== undefined && (await nameInUse(tx, userId, patch.name, row.id))) return NAME_TAKEN;
      const [updated] = await tx.update(customDomains).set(patch).where(eq(customDomains.id, row.id)).returning();
      return { status: 200, body: await customDomainDetail(tx, updated!, clock()) };
    });
  });

  /** Archives: the history stays, the domain stops counting toward the limit and can no longer be logged. */
  router.delete("/custom-domains/:id", async (req, res) => {
    const id = String(req.params.id);
    const userId = req.user!.id;
    await withIdempotency(db, req, res, `DELETE /custom-domains/${id}`, async (tx) => {
      const row = await ownDomain(tx, userId, id);
      if (!row) return NOT_FOUND;
      const now = clock();
      const [archived] = row.archivedAt
        ? [row]
        : await tx.update(customDomains).set({ archivedAt: now }).where(eq(customDomains.id, row.id)).returning();
      return { status: 200, body: await customDomainDetail(tx, archived!, now) };
    });
  });

  router.post("/custom-domains/:id/logs", async (req, res) => {
    const id = String(req.params.id);
    const body = CustomLogRequestSchema.parse(req.body);
    const userId = req.user!.id;
    await withIdempotency(
      db,
      req,
      res,
      `POST /custom-domains/${id}/logs`,
      async (tx) => {
        const now = clock();
        const occurredAt = body.occurredAt ? new Date(body.occurredAt) : now;
        const domain = await ownDomain(tx, userId, id);
        if (!domain) return NOT_FOUND;
        const badTime = await checkOccurredAt(tx, userId, now, occurredAt);
        if (badTime) return badTime;
        const [user] = await tx.select({ tz: users.timezone }).from(users).where(eq(users.id, userId)).limit(1);
        const today = localDate(now, user!.tz);

        // The clientId is the idempotency key, so a stored response replays above. Once that has been pruned, a
        // retry gets the domain's current state back without applying the log again.
        const [dup] = await tx
          .select({ domainId: customLogs.customDomainId })
          .from(customLogs)
          .where(and(eq(customLogs.userId, userId), eq(customLogs.clientId, body.clientId)))
          .limit(1);
        if (dup) {
          if (dup.domainId !== domain.id) {
            return { status: 409, body: { error: "That clientId was used for another domain", code: "duplicate_client_id" } };
          }
          const same: CustomLogResponse = { score: domain.score, streak: customStreakNow(domain.streak, domain.lastLogDate, today) };
          return { status: 200, body: same };
        }
        if (domain.archivedAt) return ARCHIVED;

        const logDate = localDate(occurredAt, user!.tz);
        const { next } = applyCustomLog({ score: domain.score, streak: domain.streak, lastLogDate: domain.lastLogDate }, logDate);
        await tx.insert(customLogs).values({
          userId,
          customDomainId: domain.id,
          clientId: body.clientId,
          value: body.value,
          note: body.note || null,
          occurredAt,
          localDate: logDate,
          createdAt: now,
        });
        await tx
          .update(customDomains)
          .set({ score: next.score, streak: next.streak, lastLogDate: next.lastLogDate })
          .where(eq(customDomains.id, domain.id));
        const out: CustomLogResponse = { score: next.score, streak: customStreakNow(next.streak, next.lastLogDate, today) };
        return { status: 201, body: out };
      },
      { preferClientId: true },
    );
  });

  return router;
}
