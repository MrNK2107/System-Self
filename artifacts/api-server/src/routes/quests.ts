import { Router, type IRouter } from "express";
import { and, asc, desc, eq, gt, gte, ne } from "drizzle-orm";
import { questChains, quests, users, type Db } from "@workspace/db";
import {
  QUEST_COMPLETE_DELTA,
  addDays,
  chainStepQuest,
  isoWeekKey,
  localDate,
  refusalOutcome,
} from "@workspace/engine";
import { QuestRefuseRequestSchema } from "@workspace/contracts";
import { withIdempotency } from "../services/idempotency";
import { rollOverDue } from "../services/rollover";
import { abandonChain, createQuests, toQuestDto } from "../services/quests";
import { applyChanges, insertNotice } from "../services/scoring";
import type { Tx } from "../services/user-lock";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const CHAIN_STEP_EXPIRY_MS = 14 * 86_400_000;

async function userTimezone(tx: Pick<Tx, "select">, userId: string): Promise<string | null> {
  const [u] = await tx.select({ tz: users.timezone }).from(users).where(eq(users.id, userId)).limit(1);
  return u?.tz ?? null;
}

export function questsRoutes(db: Db): IRouter {
  const router = Router();

  router.get("/quests", async (req, res) => {
    const userId = req.user!.id;
    const now = new Date();
    const tz = await userTimezone(db, userId);
    if (!tz) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    const since = addDays(localDate(now, tz), -1); // resolved in the last 2 local days
    const active = await db
      .select()
      .from(quests)
      .where(and(eq(quests.userId, userId), eq(quests.status, "active"), gt(quests.expiresAt, now)))
      .orderBy(asc(quests.expiresAt), asc(quests.createdAt));
    const recent = await db
      .select()
      .from(quests)
      .where(and(eq(quests.userId, userId), ne(quests.status, "active"), gte(quests.resolvedLocalDate, since)))
      .orderBy(desc(quests.resolvedAt));
    res.json({ active: active.map(toQuestDto), recent: recent.map(toQuestDto) });
  });

  router.post("/quests/:id/complete", async (req, res) => {
    const questId = String(req.params.id);
    const userId = req.user!.id;
    if (!UUID.test(questId)) {
      res.status(404).json({ error: "Quest not found" });
      return;
    }
    await withIdempotency(db, req, res, `POST /quests/${questId}/complete`, async (tx) => {
      const now = new Date();
      await rollOverDue(tx, userId, now); // roll missed dates before this write lands
      const [quest] = await tx
        .select()
        .from(quests)
        .where(and(eq(quests.id, questId), eq(quests.userId, userId)))
        .limit(1);
      if (!quest) return { status: 404, body: { error: "Quest not found" } };
      if (quest.status !== "active" || quest.expiresAt.getTime() <= now.getTime()) {
        return { status: 409, body: { error: "Quest is not active", code: "not_active" } };
      }
      const tz = (await userTimezone(tx, userId))!;
      const today = localDate(now, tz);

      const [done] = await tx
        .update(quests)
        .set({ status: "complete", resolvedAt: now, resolvedLocalDate: today })
        .where(and(eq(quests.id, quest.id), eq(quests.status, "active")))
        .returning();
      if (!done) return { status: 409, body: { error: "Quest is not active", code: "not_active" } };

      const applied = await applyChanges(
        tx,
        userId,
        [
          {
            domain: "DISCIPLINE",
            delta: QUEST_COMPLETE_DELTA,
            bonus: true,
            activity: true,
            reason: "quest_complete",
            refId: quest.id,
          },
        ],
        { localDate: today, now },
      );
      const outNotices = [...applied.notices];

      if (quest.chainId) {
        const [chain] = await tx.select().from(questChains).where(eq(questChains.id, quest.chainId)).limit(1);
        if (chain && chain.status === "active") {
          const nextStep = (quest.chainStep ?? chain.currentStep) + 1;
          if (nextStep < chain.totalSteps) {
            await tx.update(questChains).set({ currentStep: nextStep }).where(eq(questChains.id, chain.id));
            await createQuests(tx, userId, [
              {
                ...chainStepQuest(chain.templateKey, nextStep),
                expiresAt: new Date(now.getTime() + CHAIN_STEP_EXPIRY_MS),
                chainId: chain.id,
                chainStep: nextStep,
                chainTotal: chain.totalSteps,
              },
            ]);
          } else {
            await tx
              .update(questChains)
              .set({ currentStep: chain.totalSteps, status: "complete", completedAt: now })
              .where(eq(questChains.id, chain.id));
            outNotices.push(
              await insertNotice(tx, userId, "chain_complete", { name: chain.name, templateKey: chain.templateKey }, now),
            );
          }
        }
      }
      return { status: 200, body: { quest: toQuestDto(done!), results: applied.results, notices: outNotices } };
    });
  });

  router.post("/quests/:id/refuse", async (req, res) => {
    const questId = String(req.params.id);
    const userId = req.user!.id;
    const body = QuestRefuseRequestSchema.parse(req.body ?? {});
    if (!UUID.test(questId)) {
      res.status(404).json({ error: "Quest not found" });
      return;
    }
    await withIdempotency(db, req, res, `POST /quests/${questId}/refuse`, async (tx) => {
      const now = new Date();
      await rollOverDue(tx, userId, now); // roll missed dates before this write lands
      const [quest] = await tx
        .select()
        .from(quests)
        .where(and(eq(quests.id, questId), eq(quests.userId, userId)))
        .limit(1);
      if (!quest) return { status: 404, body: { error: "Quest not found" } };
      if (quest.status !== "active" || quest.expiresAt.getTime() <= now.getTime()) {
        return { status: 409, body: { error: "Quest is not active", code: "not_active" } };
      }
      const tz = (await userTimezone(tx, userId))!;
      const today = localDate(now, tz);

      // Refusals already used this ISO week (week boundaries follow the user timezone).
      const week = isoWeekKey(today);
      const recentRefused = await tx
        .select({ d: quests.resolvedLocalDate })
        .from(quests)
        .where(and(eq(quests.userId, userId), eq(quests.status, "refused"), gte(quests.resolvedLocalDate, addDays(today, -7))));
      const used = recentRefused.filter((r) => r.d && isoWeekKey(r.d) === week).length;
      const outcome = refusalOutcome(used);
      if (!outcome.allowed) {
        return { status: 409, body: { error: "Refusal limit reached for this week", code: "refusal_limit" } };
      }

      const [refused] = await tx
        .update(quests)
        .set({ status: "refused", resolvedAt: now, resolvedLocalDate: today, refusalReason: body.reason ?? null })
        .where(and(eq(quests.id, quest.id), eq(quests.status, "active")))
        .returning();
      if (!refused) return { status: 409, body: { error: "Quest is not active", code: "not_active" } };
      if (quest.chainId) await abandonChain(tx, quest.chainId);
      const applied =
        outcome.penalty > 0
          ? await applyChanges(
              tx,
              userId,
              [
                {
                  domain: "DISCIPLINE",
                  delta: -outcome.penalty,
                  bonus: false,
                  activity: false,
                  reason: "quest_refusal",
                  refId: quest.id,
                },
              ],
              { localDate: today, now },
            )
          : { results: [], notices: [] };
      return { status: 200, body: { quest: toQuestDto(refused!), penalty: outcome.penalty, results: applied.results } };
    });
  });

  return router;
}
