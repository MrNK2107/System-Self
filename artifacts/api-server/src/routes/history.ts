import { Router } from "express";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db, generatedQuestBatches, generatedQuests, systemMessages } from "@workspace/db";

const router = Router();

router.get("/system/messages", async (req, res) => {
  try {
    if (!db) return res.status(503).json({ error: "Database is not configured" });
    const username = String(req.query.username || "").trim();
    const limit = Math.min(Math.max(Number(req.query.limit || 20), 1), 100);
    if (!username) {
      return res.status(400).json({ error: "username query param is required" });
    }

    const rows = await db
      .select()
      .from(systemMessages)
      .where(eq(systemMessages.username, username))
      .orderBy(desc(systemMessages.createdAt))
      .limit(limit);

    return res.json({ items: rows });
  } catch (error) {
    req.log.error({ error }, "Failed to fetch system messages");
    return res.status(500).json({ error: "Failed to fetch system messages" });
  }
});

router.get("/system/quests/history", async (req, res) => {
  try {
    if (!db) return res.status(503).json({ error: "Database is not configured" });
    const username = String(req.query.username || "").trim();
    const limit = Math.min(Math.max(Number(req.query.limit || 10), 1), 50);
    if (!username) {
      return res.status(400).json({ error: "username query param is required" });
    }

    const batches = await db
      .select()
      .from(generatedQuestBatches)
      .where(eq(generatedQuestBatches.username, username))
      .orderBy(desc(generatedQuestBatches.createdAt))
      .limit(limit);

    const batchIds = batches.map((b) => b.id);
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
      items: batches.map((batch) => ({
        ...batch,
        quests: questsByBatch.get(batch.id) ?? [],
      })),
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

    const from = new Date();
    from.setDate(from.getDate() - 7);

    const [messageStats] = await db
      .select({
        count: sql<number>`count(*)::int`,
      })
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
      .where(
        and(
          eq(generatedQuests.username, username),
          gte(generatedQuests.createdAt, from),
        ),
      )
      .groupBy(generatedQuests.domain);

    return res.json({
      username,
      windowDays: 7,
      from: from.toISOString(),
      to: new Date().toISOString(),
      messagesGenerated: messageStats?.count ?? 0,
      questBatchesGenerated: questStats?.batchCount ?? 0,
      questsGenerated: questStats?.questCount ?? 0,
      domainBreakdown,
    });
  } catch (error) {
    req.log.error({ error }, "Failed to fetch weekly recap");
    return res.status(500).json({ error: "Failed to fetch weekly recap" });
  }
});

export default router;
