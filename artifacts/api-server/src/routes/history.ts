import { DB_UNAVAILABLE } from "../lib/db-unavailable";
import { Router, type IRouter } from "express";
import { and, desc, eq, gte, inArray, lt, lte, sql } from "drizzle-orm";
import { z, ZodError } from "zod";
import { generatedQuestBatches, generatedQuests, questCompletionEvents, systemMessages, users, type Db } from "@workspace/db";
import { addDays, localDate } from "@workspace/engine";
import type { AiDeps } from "../lib/ai";
import { buildUserContext, generateMessage } from "../services/ai-context";
import { cachedMessage, storeMessage } from "../services/messages";
import { buildWeeklyRecap } from "../services/recap";
import { ensureRolledOver } from "../services/rollover";
import { withUserLock } from "../services/user-lock";

const messageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.coerce.number().int().positive().optional(),
  messageType: z.string().optional(),
  rank: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

const questHistoryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
  cursor: z.coerce.number().int().positive().optional(),
  rank: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

const completionSummaryQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(90).default(14),
});

export function historyRoutes(db: Db | null, ai: AiDeps = {}): IRouter {
const router = Router();

router.get("/system/messages", async (req, res) => {
  try {
    if (!db) return res.status(503).json(DB_UNAVAILABLE);
    const query = messageQuerySchema.parse(req.query);

    const whereClauses = [eq(systemMessages.userId, req.user!.id)];
    if (query.cursor) whereClauses.push(lt(systemMessages.id, query.cursor));
    if (query.messageType) whereClauses.push(eq(systemMessages.messageType, query.messageType));
    if (query.rank) whereClauses.push(eq(systemMessages.rank, query.rank));
    if (query.from) whereClauses.push(gte(systemMessages.createdAt, new Date(query.from)));
    if (query.to) whereClauses.push(lte(systemMessages.createdAt, new Date(query.to)));

    const rows = await db
      .select()
      .from(systemMessages)
      .where(and(...whereClauses))
      .orderBy(desc(systemMessages.id))
      .limit(query.limit + 1);

    const hasMore = rows.length > query.limit;
    const items = hasMore ? rows.slice(0, query.limit) : rows;
    const nextCursor = hasMore ? items[items.length - 1]?.id ?? null : null;

    return res.json({ items, page: { hasMore, nextCursor } });
  } catch (error) {
    if (error instanceof ZodError) throw error; // validation -> 400 via errorHandler
    req.log.error({ error }, "Failed to fetch system messages");
    return res.status(500).json({ error: "Failed to fetch system messages" });
  }
});

router.get("/system/quests/history", async (req, res) => {
  try {
    if (!db) return res.status(503).json(DB_UNAVAILABLE);
    const query = questHistoryQuerySchema.parse(req.query);

    const whereClauses = [eq(generatedQuestBatches.userId, req.user!.id)];
    if (query.cursor) whereClauses.push(lt(generatedQuestBatches.id, query.cursor));
    if (query.rank) whereClauses.push(eq(generatedQuestBatches.rank, query.rank));
    if (query.from) whereClauses.push(gte(generatedQuestBatches.createdAt, new Date(query.from)));
    if (query.to) whereClauses.push(lte(generatedQuestBatches.createdAt, new Date(query.to)));

    const batches = await db
      .select()
      .from(generatedQuestBatches)
      .where(and(...whereClauses))
      .orderBy(desc(generatedQuestBatches.id))
      .limit(query.limit + 1);

    const hasMore = batches.length > query.limit;
    const sliced = hasMore ? batches.slice(0, query.limit) : batches;
    const nextCursor = hasMore ? sliced[sliced.length - 1]?.id ?? null : null;

    const batchIds = sliced.map((b) => b.id);
    const quests = batchIds.length
      ? await db.select().from(generatedQuests).where(inArray(generatedQuests.batchId, batchIds))
      : [];

    const questsByBatch = new Map<number, typeof quests>();
    for (const quest of quests) {
      const arr = questsByBatch.get(quest.batchId) ?? [];
      arr.push(quest);
      questsByBatch.set(quest.batchId, arr);
    }

    return res.json({
      items: sliced.map((batch) => ({
        ...batch,
        quests: questsByBatch.get(batch.id) ?? [],
      })),
      page: { hasMore, nextCursor },
    });
  } catch (error) {
    if (error instanceof ZodError) throw error; // validation -> 400 via errorHandler
    req.log.error({ error }, "Failed to fetch quest history");
    return res.status(500).json({ error: "Failed to fetch quest history" });
  }
});

router.get("/recap/weekly", async (req, res) => {
  if (!db) return res.status(503).json(DB_UNAVAILABLE);
  const userId = req.user!.id;
  const now = new Date();
  await ensureRolledOver(db, userId, now);
  const [user] = await db.select({ tz: users.timezone }).from(users).where(eq(users.id, userId)).limit(1);
  if (!user) return res.status(404).json({ error: "User not found" });
  return res.json(await buildWeeklyRecap(db, userId, localDate(now, user.tz), user.tz));
});

router.get("/recap/weekly/debrief", async (req, res) => {
  if (!db) return res.status(503).json(DB_UNAVAILABLE);
  const userId = req.user!.id;
  const now = new Date();
  await ensureRolledOver(db, userId, now);
  const ctx = await buildUserContext(db, userId, now);
  if (!ctx) return res.status(409).json({ error: "Onboarding required", code: "not_onboarded" });
  // Cached per user per local day in system_messages (the same row POST /messages weekly_debrief uses).
  const respond = (row: { message: string; model: string; attempts: number; promptVersion: string }) => ({
    weekStart: addDays(ctx.today, -6),
    debrief: row.message,
    meta: { model: row.model, attempts: row.attempts, promptVersion: row.promptVersion },
  });
  const cached = await cachedMessage(db, userId, "weekly_debrief", ctx.today);
  if (cached) return res.json(respond(cached));
  ctx.weeklyRecap = await buildWeeklyRecap(db, userId, ctx.today, ctx.timezone);
  const generated = await generateMessage("weekly_debrief", ctx, ai);
  // Re-check under the lock: a concurrent request may have stored one while the model ran.
  const out = await withUserLock(db, userId, async (tx) => {
    const again = await cachedMessage(tx, userId, "weekly_debrief", ctx.today);
    if (again) return again;
    await storeMessage(tx, userId, "weekly_debrief", ctx, generated);
    return generated;
  });
  return res.json(respond(out));
});

router.get("/system/completions/summary", async (req, res) => {
  try {
    if (!db) return res.status(503).json(DB_UNAVAILABLE);
    const query = completionSummaryQuerySchema.parse(req.query);
    const from = new Date();
    from.setDate(from.getDate() - query.days);

    const totals = await db
      .select({
        status: questCompletionEvents.status,
        count: sql<number>`count(*)::int`,
      })
      .from(questCompletionEvents)
      .where(and(eq(questCompletionEvents.userId, req.user!.id), gte(questCompletionEvents.completedAt, from)))
      .groupBy(questCompletionEvents.status);

    const byDomain = await db
      .select({
        domain: questCompletionEvents.domain,
        status: questCompletionEvents.status,
        count: sql<number>`count(*)::int`,
      })
      .from(questCompletionEvents)
      .where(and(eq(questCompletionEvents.userId, req.user!.id), gte(questCompletionEvents.completedAt, from)))
      .groupBy(questCompletionEvents.domain, questCompletionEvents.status);

    const daily = await db
      .select({
        day: sql<string>`to_char(${questCompletionEvents.completedAt}, 'YYYY-MM-DD')`,
        status: questCompletionEvents.status,
        count: sql<number>`count(*)::int`,
      })
      .from(questCompletionEvents)
      .where(and(eq(questCompletionEvents.userId, req.user!.id), gte(questCompletionEvents.completedAt, from)))
      .groupBy(sql`to_char(${questCompletionEvents.completedAt}, 'YYYY-MM-DD')`, questCompletionEvents.status)
      .orderBy(sql`to_char(${questCompletionEvents.completedAt}, 'YYYY-MM-DD') asc`);

    const attempts = totals.reduce((sum, row) => sum + row.count, 0);
    const completed = totals.find((r) => r.status === "complete")?.count ?? 0;

    return res.json({
      username: req.user!.username,
      windowDays: query.days,
      from: from.toISOString(),
      to: new Date().toISOString(),
      attempts,
      completed,
      completionRate: attempts > 0 ? Math.round((completed / attempts) * 100) : 0,
      totals,
      byDomain,
      daily,
    });
  } catch (error) {
    if (error instanceof ZodError) throw error; // validation -> 400 via errorHandler
    req.log.error({ error }, "Failed to fetch completion summary");
    return res.status(500).json({ error: "Failed to fetch completion summary" });
  }
});

return router;
}
