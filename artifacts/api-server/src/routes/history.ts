import { Router } from "express";
import { and, desc, eq, gte, inArray, lt, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { db, generatedQuestBatches, generatedQuests, questCompletionEvents, systemMessages } from "@workspace/db";
import { generateWithFallback } from "../lib/ai";
import { requireOwnership } from "../middlewares/auth";

const router = Router();

const messageQuerySchema = z.object({
  username: z.string().min(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.coerce.number().int().positive().optional(),
  messageType: z.string().optional(),
  rank: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

const questHistoryQuerySchema = z.object({
  username: z.string().min(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
  cursor: z.coerce.number().int().positive().optional(),
  rank: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

const completionSummaryQuerySchema = z.object({
  username: z.string().min(1),
  days: z.coerce.number().int().min(1).max(90).default(14),
});

router.get("/system/messages", async (req, res) => {
  try {
    if (!db) return res.status(503).json({ error: "Database is not configured" });
    const query = messageQuerySchema.parse(req.query);
    if (!requireOwnership(req, res, query.username)) return;

    const whereClauses = [eq(systemMessages.username, query.username)];
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
    req.log.error({ error }, "Failed to fetch system messages");
    return res.status(500).json({ error: "Failed to fetch system messages" });
  }
});

router.get("/system/quests/history", async (req, res) => {
  try {
    if (!db) return res.status(503).json({ error: "Database is not configured" });
    const query = questHistoryQuerySchema.parse(req.query);
    if (!requireOwnership(req, res, query.username)) return;

    const whereClauses = [eq(generatedQuestBatches.username, query.username)];
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
    req.log.error({ error }, "Failed to fetch quest history");
    return res.status(500).json({ error: "Failed to fetch quest history" });
  }
});

router.get("/system/recap/weekly", async (req, res) => {
  try {
    if (!db) return res.status(503).json({ error: "Database is not configured" });
    const username = String(req.query.username || "").trim();
    if (!username) {
      return res.status(400).json({ error: "username query param is required" });
    }
    if (!requireOwnership(req, res, username)) return;

    const from = new Date();
    from.setDate(from.getDate() - 7);

    const [messageStats] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(systemMessages)
      .where(and(eq(systemMessages.username, username), gte(systemMessages.createdAt, from)));

    const [questStats] = await db
      .select({
        batchCount: sql<number>`count(distinct ${generatedQuestBatches.id})::int`,
        questCount: sql<number>`count(${generatedQuests.id})::int`,
      })
      .from(generatedQuestBatches)
      .leftJoin(generatedQuests, eq(generatedQuestBatches.id, generatedQuests.batchId))
      .where(and(eq(generatedQuestBatches.username, username), gte(generatedQuestBatches.createdAt, from)));

    const domainBreakdown = await db
      .select({
        domain: generatedQuests.domain,
        count: sql<number>`count(*)::int`,
      })
      .from(generatedQuests)
      .where(and(eq(generatedQuests.username, username), gte(generatedQuests.createdAt, from)))
      .groupBy(generatedQuests.domain);

    const [completionStats] = await db
      .select({
        attempts: sql<number>`count(*)::int`,
        completed: sql<number>`sum(case when ${questCompletionEvents.status} = 'complete' then 1 else 0 end)::int`,
      })
      .from(questCompletionEvents)
      .where(and(eq(questCompletionEvents.username, username), gte(questCompletionEvents.completedAt, from)));

    return res.json({
      username,
      windowDays: 7,
      from: from.toISOString(),
      to: new Date().toISOString(),
      messagesGenerated: messageStats?.count ?? 0,
      questBatchesGenerated: questStats?.batchCount ?? 0,
      questsGenerated: questStats?.questCount ?? 0,
      questAttempts: completionStats?.attempts ?? 0,
      questsCompleted: completionStats?.completed ?? 0,
      completionRate:
        (completionStats?.attempts ?? 0) > 0
          ? Math.round(((completionStats?.completed ?? 0) / (completionStats?.attempts ?? 1)) * 100)
          : 0,
      domainBreakdown,
    });
  } catch (error) {
    req.log.error({ error }, "Failed to fetch weekly recap");
    return res.status(500).json({ error: "Failed to fetch weekly recap" });
  }
});

router.get("/system/recap/weekly/debrief", async (req, res) => {
  try {
    if (!db) return res.status(503).json({ error: "Database is not configured" });
    const username = String(req.query.username || "").trim();
    if (!username) {
      return res.status(400).json({ error: "username query param is required" });
    }
    if (!requireOwnership(req, res, username)) return;

    const from = new Date();
    from.setDate(from.getDate() - 7);

    const [messageStats] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(systemMessages)
      .where(and(eq(systemMessages.username, username), gte(systemMessages.createdAt, from)));

    const [questStats] = await db
      .select({
        batchCount: sql<number>`count(distinct ${generatedQuestBatches.id})::int`,
        questCount: sql<number>`count(${generatedQuests.id})::int`,
      })
      .from(generatedQuestBatches)
      .leftJoin(generatedQuests, eq(generatedQuestBatches.id, generatedQuests.batchId))
      .where(and(eq(generatedQuestBatches.username, username), gte(generatedQuestBatches.createdAt, from)));

    const domainBreakdown = await db
      .select({
        domain: generatedQuests.domain,
        count: sql<number>`count(*)::int`,
      })
      .from(generatedQuests)
      .where(and(eq(generatedQuests.username, username), gte(generatedQuests.createdAt, from)))
      .groupBy(generatedQuests.domain);
    const [completionStats] = await db
      .select({
        attempts: sql<number>`count(*)::int`,
        completed: sql<number>`sum(case when ${questCompletionEvents.status} = 'complete' then 1 else 0 end)::int`,
      })
      .from(questCompletionEvents)
      .where(and(eq(questCompletionEvents.username, username), gte(questCompletionEvents.completedAt, from)));
    const completionRate =
      (completionStats?.attempts ?? 0) > 0
        ? Math.round(((completionStats?.completed ?? 0) / (completionStats?.attempts ?? 1)) * 100)
        : 0;

    const prompt = `Generate a strict weekly debrief for ${username}.
Data window: last 7 days.
Messages generated: ${messageStats?.count ?? 0}
Quest batches generated: ${questStats?.batchCount ?? 0}
Quests generated: ${questStats?.questCount ?? 0}
Quest attempts tracked: ${completionStats?.attempts ?? 0}
Quests completed: ${completionStats?.completed ?? 0}
Completion rate: ${completionRate}%
Domain quest distribution: ${domainBreakdown.map((d) => `${d.domain}:${d.count}`).join(", ") || "none"}

Style:
- Second person
- Clinical and direct
- 4-6 sentences
- Include one verdict word at the end: Acceptable, Insufficient, or Pathetic`;

    const ai = await generateWithFallback({
      systemInstruction: "You are THE SYSTEM. Output only the debrief text.",
      prompt,
      maxOutputTokens: 220,
      temperature: 0.5,
    });

    return res.json({
      username,
      windowDays: 7,
      from: from.toISOString(),
      to: new Date().toISOString(),
      debrief: ai.text,
      meta: { model: ai.model, attempts: ai.attempts, promptVersion: "weekly-debrief-v1" },
    });
  } catch (error) {
    req.log.error({ error }, "Failed to generate weekly debrief");
    return res.status(500).json({ error: "Failed to generate weekly debrief" });
  }
});

router.get("/system/completions/summary", async (req, res) => {
  try {
    if (!db) return res.status(503).json({ error: "Database is not configured" });
    const query = completionSummaryQuerySchema.parse(req.query);
    if (!requireOwnership(req, res, query.username)) return;
    const from = new Date();
    from.setDate(from.getDate() - query.days);

    const totals = await db
      .select({
        status: questCompletionEvents.status,
        count: sql<number>`count(*)::int`,
      })
      .from(questCompletionEvents)
      .where(and(eq(questCompletionEvents.username, query.username), gte(questCompletionEvents.completedAt, from)))
      .groupBy(questCompletionEvents.status);

    const byDomain = await db
      .select({
        domain: questCompletionEvents.domain,
        status: questCompletionEvents.status,
        count: sql<number>`count(*)::int`,
      })
      .from(questCompletionEvents)
      .where(and(eq(questCompletionEvents.username, query.username), gte(questCompletionEvents.completedAt, from)))
      .groupBy(questCompletionEvents.domain, questCompletionEvents.status);

    const daily = await db
      .select({
        day: sql<string>`to_char(${questCompletionEvents.completedAt}, 'YYYY-MM-DD')`,
        status: questCompletionEvents.status,
        count: sql<number>`count(*)::int`,
      })
      .from(questCompletionEvents)
      .where(and(eq(questCompletionEvents.username, query.username), gte(questCompletionEvents.completedAt, from)))
      .groupBy(sql`to_char(${questCompletionEvents.completedAt}, 'YYYY-MM-DD')`, questCompletionEvents.status)
      .orderBy(sql`to_char(${questCompletionEvents.completedAt}, 'YYYY-MM-DD') asc`);

    const attempts = totals.reduce((sum, row) => sum + row.count, 0);
    const completed = totals.find((r) => r.status === "complete")?.count ?? 0;

    return res.json({
      username: query.username,
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
    req.log.error({ error }, "Failed to fetch completion summary");
    return res.status(500).json({ error: "Failed to fetch completion summary" });
  }
});

export default router;
