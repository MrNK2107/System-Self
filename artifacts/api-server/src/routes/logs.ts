import { Router, type IRouter } from "express";
import { and, desc, eq, lt, or } from "drizzle-orm";
import { logs, profiles, users, type Db } from "@workspace/db";
import { localDate, logChanges } from "@workspace/engine";
import { LogListQuerySchema, LogRequestSchema } from "@workspace/contracts";
import { withIdempotency } from "../services/idempotency";
import { rollOverDue } from "../services/rollover";
import { track } from "../services/analytics";
import { applyActivityChanges } from "../services/activity";
import { countHomeSession } from "../services/comeback";

const RETROACTIVE_LIMIT_MS = 48 * 3600_000;
const FUTURE_TOLERANCE_MS = 5 * 60_000;

function toLogDto(l: typeof logs.$inferSelect) {
  return {
    id: l.id,
    clientId: l.clientId,
    domain: l.domain as "BODY" | "MIND" | "WEALTH" | "SOCIAL" | "DISCIPLINE",
    logType: l.logType,
    data: l.data,
    freeText: l.freeText,
    forbidden: l.forbidden,
    occurredAt: l.occurredAt.toISOString(),
    localDate: l.localDate,
    isRetroactive: l.isRetroactive,
    createdAt: l.createdAt.toISOString(),
  };
}

function encodeCursor(l: typeof logs.$inferSelect): string {
  return Buffer.from(`${l.occurredAt.toISOString()}|${l.id}`).toString("base64url");
}

function decodeCursor(c: string): { at: Date; id: string } | null {
  const [iso, id] = Buffer.from(c, "base64url").toString().split("|");
  const at = new Date(iso ?? "");
  if (!iso || !id || Number.isNaN(at.getTime())) return null;
  return { at, id };
}

export function logsRoutes(db: Db, clock: () => Date = () => new Date()): IRouter {
  const router = Router();

  router.post("/logs", async (req, res) => {
    const body = LogRequestSchema.parse(req.body);
    const userId = req.user!.id;

    await withIdempotency(db, req, res, "POST /logs", async (tx) => {
      const now = clock();
      const occurredAt = body.occurredAt ? new Date(body.occurredAt) : now;
      if (now.getTime() - occurredAt.getTime() > RETROACTIVE_LIMIT_MS) {
        return { status: 422, body: { error: "Log is too old", code: "retroactive_limit" } };
      }
      if (occurredAt.getTime() - now.getTime() > FUTURE_TOLERANCE_MS) {
        return { status: 422, body: { error: "Log is in the future", code: "future_occurred_at" } };
      }

      const [user] = await tx.select().from(users).where(eq(users.id, userId)).limit(1);
      const [profile] = await tx.select({ id: profiles.userId }).from(profiles).where(eq(profiles.userId, userId));
      if (!user || !profile) return { status: 409, body: { error: "Not onboarded", code: "not_onboarded" } };
      const today = localDate(now, user.timezone);
      const logDate = localDate(occurredAt, user.timezone);
      // Roll only the dates before the log's own date, so an offline log synced after midnight still
      // counts for its date's streak and decay; the remaining due dates roll after it is applied.
      await rollOverDue(tx, userId, now, { before: logDate });

      // The clientId is the idempotency key, so a stored response replays above. Once that has been
      // pruned, a retry gets the stored log back without applying it again.
      const [dup] = await tx
        .select()
        .from(logs)
        .where(and(eq(logs.userId, userId), eq(logs.clientId, body.clientId)))
        .limit(1);
      if (dup) return { status: 200, body: { log: toLogDto(dup), results: [], notices: [] } };

      const forbidden = body.forbidden ?? false;
      const [log] = await tx
        .insert(logs)
        .values({
          userId,
          clientId: body.clientId,
          domain: body.domain,
          logType: body.logType,
          data: body.data ?? {},
          freeText: body.freeText ?? null,
          forbidden,
          occurredAt,
          localDate: logDate,
          isRetroactive: logDate < today,
          createdAt: now,
        })
        .returning();

      const changes = logChanges(body.domain, forbidden).map((c) => ({
        ...c,
        reason: forbidden ? ("forbidden" as const) : ("log" as const),
        refId: log!.id,
      }));
      const { results, notices } = await applyActivityChanges(tx, userId, changes, { localDate: logDate, now }, {
        afterApply: () => countHomeSession(tx, userId, { logType: body.logType, forbidden }, now),
      });
      await rollOverDue(tx, userId, now);
      if (body.logType === "floor_session") await track(tx, userId, "floor_completed", { logId: log!.id });
      return { status: 201, body: { log: toLogDto(log!), results, notices } };
    }, { preferClientId: true });
  });

  router.get("/logs", async (req, res) => {
    const q = LogListQuerySchema.parse(req.query);
    const userId = req.user!.id;
    let cursorWhere;
    if (q.cursor) {
      const c = decodeCursor(q.cursor);
      if (!c) {
        res.status(400).json({ error: "Invalid cursor", code: "invalid_cursor" });
        return;
      }
      cursorWhere = or(lt(logs.occurredAt, c.at), and(eq(logs.occurredAt, c.at), lt(logs.id, c.id)));
    }
    const rows = await db
      .select()
      .from(logs)
      .where(and(eq(logs.userId, userId), cursorWhere))
      .orderBy(desc(logs.occurredAt), desc(logs.id))
      .limit(q.limit + 1);
    const page = rows.slice(0, q.limit);
    res.json({
      items: page.map(toLogDto),
      nextCursor: rows.length > q.limit ? encodeCursor(page[page.length - 1]!) : null,
    });
  });

  return router;
}
