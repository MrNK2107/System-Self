import { Router, type IRouter } from "express";
import { and, desc, eq, gte } from "drizzle-orm";
import { quests, shadowTakeovers, users, type Db } from "@workspace/db";
import { addDays, localDate } from "@workspace/engine";
import { DeferralsQuerySchema, ShadowTakeoversQuerySchema } from "@workspace/contracts";

export function adherenceRoutes(db: Db): IRouter {
  const router = Router();

  async function today(userId: string, now: Date): Promise<string | null> {
    const [u] = await db.select({ tz: users.timezone }).from(users).where(eq(users.id, userId)).limit(1);
    return u ? localDate(now, u.tz) : null;
  }

  /** The user's own refusal reasons, newest first. `countThisWeek` counts the last 7 local days. */
  router.get("/adherence/deferrals", async (req, res) => {
    const q = DeferralsQuerySchema.parse(req.query);
    const userId = req.user!.id;
    const d = await today(userId, new Date());
    if (!d) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    const rows = await db
      .select({
        questTitle: quests.title,
        domain: quests.domain,
        reason: quests.refusalReason,
        localDate: quests.resolvedLocalDate,
      })
      .from(quests)
      .where(and(eq(quests.userId, userId), eq(quests.status, "refused"), gte(quests.resolvedLocalDate, addDays(d, -(q.days - 1)))))
      .orderBy(desc(quests.resolvedAt), desc(quests.createdAt));
    const items = rows.flatMap((r) =>
      r.reason?.trim() && r.localDate
        ? [{ questTitle: r.questTitle, domain: r.domain, reason: r.reason, localDate: r.localDate }]
        : [],
    );
    const weekStart = addDays(d, -6);
    res.json({ items, countThisWeek: items.filter((i) => i.localDate >= weekStart).length });
  });

  router.get("/adherence/shadow-takeovers", async (req, res) => {
    const q = ShadowTakeoversQuerySchema.parse(req.query);
    const userId = req.user!.id;
    const d = await today(userId, new Date());
    if (!d) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    const rows = await db
      .select({ questTitle: shadowTakeovers.questTitle, localDate: shadowTakeovers.localDate })
      .from(shadowTakeovers)
      .where(and(eq(shadowTakeovers.userId, userId), gte(shadowTakeovers.localDate, addDays(d, -(q.days - 1)))))
      .orderBy(desc(shadowTakeovers.createdAt));
    res.json({ items: rows, count: rows.length });
  });

  return router;
}
