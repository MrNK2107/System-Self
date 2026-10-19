import { Router, type IRouter } from "express";
import { and, desc, eq, lt, or } from "drizzle-orm";
import { logs, profiles, quests, users, type Db } from "@workspace/db";
import { localDate, logChanges } from "@workspace/engine";
import { LogListQuerySchema, LogRequestSchema, parseLogData } from "@workspace/contracts";
import { withIdempotency } from "../services/idempotency";
import { rollOverDue } from "../services/rollover";
import { track } from "../services/analytics";
import { applyActivityChanges } from "../services/activity";
import { countHomeSession } from "../services/comeback";
import { occurredAtError } from "../services/retroactive";

/** A stored log as the API returns it (also used by routes that record logs of their own, e.g. finance). */
export function toLogDto(l: typeof logs.$inferSelect) {
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function logsRoutes(db: Db, clock: () => Date = () => new Date()): IRouter {
  const router = Router();

  router.post("/logs", async (req, res) => {
    const body = LogRequestSchema.parse(req.body);
    const userId = req.user!.id;
    // Data is checked against the schema of its (domain, logType) before anything is stored or scored.
    const parsedData = parseLogData(body.domain, body.logType, body.data);
    if (!parsedData.ok) {
      res.status(400).json({
        error: parsedData.code === "unknown_log_type" ? "Unknown log type" : "Validation failed",
        code: parsedData.code,
        issues: parsedData.issues,
      });
      return;
    }
    const data = parsedData.data;

    await withIdempotency(db, req, res, "POST /logs", async (tx) => {
      const now = clock();
      const occurredAt = body.occurredAt ? new Date(body.occurredAt) : now;
      const tooOld = occurredAtError(now, occurredAt);
      if (tooOld) return tooOld;

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
          data,
          freeText: body.freeText ?? null,
          forbidden,
          occurredAt,
          localDate: logDate,
          isRetroactive: logDate < today,
          createdAt: now,
        })
        .returning();

      const changes = logChanges(body.domain, body.logType, data, forbidden).map((c) => ({
        ...c,
        reason: forbidden ? ("forbidden" as const) : ("log" as const),
        refId: log!.id,
      }));
      const { results, notices } = await applyActivityChanges(tx, userId, changes, { localDate: logDate, now }, {
        afterApply: () => countHomeSession(tx, userId, { id: log!.id, logType: body.logType, forbidden, localDate: logDate }, now),
      });
      await rollOverDue(tx, userId, now);
      // Only a floor session started from a refusal's floor offer completes that offer (floorUptake): the id
      // must be a quest this user refused, so a client cannot inflate the metric with arbitrary ids.
      const refusedQuestId = data.refusedQuestId;
      if (body.logType === "floor_session" && typeof refusedQuestId === "string" && UUID.test(refusedQuestId)) {
        const [refused] = await tx
          .select({ id: quests.id })
          .from(quests)
          .where(and(eq(quests.id, refusedQuestId), eq(quests.userId, userId), eq(quests.status, "refused")))
          .limit(1);
        if (refused) await track(tx, userId, "floor_completed", { logId: log!.id, questId: refused.id });
      }
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
