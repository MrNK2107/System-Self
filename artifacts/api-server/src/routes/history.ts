import { DB_UNAVAILABLE } from "../lib/db-unavailable";
import { Router, type IRouter } from "express";
import { and, asc, desc, eq, gte, inArray, lt, lte, sql } from "drizzle-orm";
import { z, ZodError } from "zod";
import { dailySnapshots, generatedQuestBatches, generatedQuests, quests, systemMessages, users, type Db } from "@workspace/db";
import { addDays, localDate } from "@workspace/engine";
import type { AiDeps } from "../lib/ai";
import { buildUserContext, generateMessage } from "../services/ai-context";
import { cachedMessage, storeMessage } from "../services/messages";
import { buildWeeklyRecap } from "../services/recap";
import { ensureRolledOver } from "../services/rollover";
import { withUserLock } from "../services/user-lock";
import { countsForRank } from "../services/quests";
import { isPro } from "../services/entitlements";
import { FREE_HISTORY_DAYS, PRO_HISTORY_DAYS, type QuestTrend, type ScoreHistory } from "@workspace/contracts";

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

// Clamped to the caller's history window (free 14 days, PRO 365) by historyWindow.
const completionSummaryQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(PRO_HISTORY_DAYS).default(FREE_HISTORY_DAYS),
});

// Whole-number text only: "1.5", "-3", "" and "abc" are 400s. Absent means the free window.
const historyDaysQuerySchema = z.object({
  days: z
    .string()
    .regex(/^[0-9]+$/)
    .transform(Number)
    .pipe(z.number().int().min(1).max(PRO_HISTORY_DAYS))
    .optional(),
});

const RESOLVED_STATUSES = ["complete", "failed", "refused"] as const;
type ResolvedStatus = (typeof RESOLVED_STATUSES)[number];

export function historyRoutes(db: Db | null, ai: AiDeps = {}, clock: () => Date = () => new Date()): IRouter {
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
  if (!db) return res.status(503).json(DB_UNAVAILABLE);
  const query = completionSummaryQuerySchema.parse(req.query);
  const userId = req.user!.id;
  // The last `days` local days, today included, by the quest's resolution date (free users see at most 14).
  const win = await historyWindow(db, userId, query.days);
  if (!win) return res.status(404).json({ error: "User not found" });
  const { from, to } = win;
  const rows = await db
    .select({
      domain: quests.domain,
      status: quests.status,
      day: quests.resolvedLocalDate,
      count: sql<number>`count(*)::int`,
    })
    .from(quests)
    .where(
      and(
        eq(quests.userId, userId),
        countsForRank,
        inArray(quests.status, RESOLVED_STATUSES),
        gte(quests.resolvedLocalDate, from),
        lte(quests.resolvedLocalDate, to),
      ),
    )
    .groupBy(quests.domain, quests.status, quests.resolvedLocalDate);

  const sum = (pick: (r: (typeof rows)[number]) => string) => {
    const totals = new Map<string, { key: string; status: ResolvedStatus; count: number }>();
    for (const r of rows) {
      const key = pick(r);
      const id = `${key}|${r.status}`;
      const cur = totals.get(id) ?? { key, status: r.status as ResolvedStatus, count: 0 };
      cur.count += r.count;
      totals.set(id, cur);
    }
    return [...totals.values()].sort((a, b) => (a.key === b.key ? a.status.localeCompare(b.status) : a.key.localeCompare(b.key)));
  };
  const attempts = rows.reduce((n, r) => n + r.count, 0);
  const completed = rows.filter((r) => r.status === "complete").reduce((n, r) => n + r.count, 0);
  return res.json({
    windowDays: win.days,
    from,
    to,
    attempts,
    completed,
    completionRate: attempts > 0 ? Math.round((completed / attempts) * 100) : 0,
    byDomain: sum((r) => r.domain).map(({ key, status, count }) => ({ domain: key, status, count })),
    daily: sum((r) => r.day!).map(({ key, status, count }) => ({ day: key, status, count })),
  });
});

/** The window a history request is served: PRO up to 365 days, everyone else 14 (a larger ask is clamped, not refused). */
async function historyWindow(db: Db, userId: string, requested: number | undefined) {
  const now = clock();
  const maxDays = (await isPro(db, userId, now)) ? PRO_HISTORY_DAYS : FREE_HISTORY_DAYS;
  const days = Math.min(requested ?? FREE_HISTORY_DAYS, maxDays);
  const [user] = await db.select({ tz: users.timezone }).from(users).where(eq(users.id, userId)).limit(1);
  if (!user) return null;
  const to = localDate(now, user.tz);
  return { days, maxDays, to, from: addDays(to, -(days - 1)) };
}

// Daily domain scores and rank for the charts. Deliberately selects no `hidden` column: the hidden score never leaves the server.
router.get("/history/scores", async (req, res) => {
  if (!db) return res.status(503).json(DB_UNAVAILABLE);
  const query = historyDaysQuerySchema.parse(req.query);
  const userId = req.user!.id;
  const win = await historyWindow(db, userId, query.days);
  if (!win) return res.status(404).json({ error: "User not found" });
  const rows = await db
    .select({ date: dailySnapshots.localDate, rank: dailySnapshots.rank, scores: dailySnapshots.scores })
    .from(dailySnapshots)
    .where(and(eq(dailySnapshots.userId, userId), gte(dailySnapshots.localDate, win.from), lte(dailySnapshots.localDate, win.to)))
    .orderBy(asc(dailySnapshots.localDate));
  const body: ScoreHistory = {
    days: win.days,
    from: win.from,
    to: win.to,
    maxDays: win.maxDays,
    items: rows.map((r) => ({ date: r.date, rank: r.rank, scores: r.scores as Record<string, number> })),
  };
  return res.json(body);
});

// Completion trend over rank-counting quests only: bonus quests are excluded (countsForRank).
router.get("/history/quests", async (req, res) => {
  if (!db) return res.status(503).json(DB_UNAVAILABLE);
  const query = historyDaysQuerySchema.parse(req.query);
  const userId = req.user!.id;
  const win = await historyWindow(db, userId, query.days);
  if (!win) return res.status(404).json({ error: "User not found" });
  const rows = await db
    .select({
      date: quests.resolvedLocalDate,
      completed: sql<number>`count(*) filter (where ${quests.status} = 'complete')::int`,
      resolved: sql<number>`count(*)::int`,
    })
    .from(quests)
    .where(
      and(
        eq(quests.userId, userId),
        countsForRank,
        inArray(quests.status, RESOLVED_STATUSES),
        gte(quests.resolvedLocalDate, win.from),
        lte(quests.resolvedLocalDate, win.to),
      ),
    )
    .groupBy(quests.resolvedLocalDate)
    .orderBy(asc(quests.resolvedLocalDate));
  const body: QuestTrend = {
    days: win.days,
    from: win.from,
    to: win.to,
    maxDays: win.maxDays,
    items: rows.map((r) => ({ date: r.date!, completed: r.completed, resolved: r.resolved })),
  };
  return res.json(body);
});

return router;
}
