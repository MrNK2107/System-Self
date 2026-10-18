import { Router, type IRouter } from "express";
import { and, asc, desc, eq, gt, gte, ne } from "drizzle-orm";
import { generatedQuestBatches, generatedQuests, questChains, quests, users, type Db } from "@workspace/db";
import {
  QUEST_COMPLETE_DELTA,
  addDays,
  chainStepQuest,
  endOfLocalDay,
  isoWeekKey,
  localDate,
  refusalOutcome,
} from "@workspace/engine";
import { QuestRefuseRequestSchema } from "@workspace/contracts";
import type { AiDeps } from "../lib/ai";
import { generateQuestsRequestSchema } from "../lib/schemas";
import { findReplay, readKey, withIdempotency, type HandlerResult } from "../services/idempotency";
import { rollOverDue } from "../services/rollover";
import { abandonChain, activeBoard, createQuests, hasActiveChain, toQuestDto } from "../services/quests";
import { applyChanges, insertNotice } from "../services/scoring";
import { withUserLock, type Tx } from "../services/user-lock";
import {
  buildUserContext,
  generateQuestCandidates,
  pickQuests,
  type PromptContext,
  type QuestNeed,
} from "../services/ai-context";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const CHAIN_STEP_EXPIRY_MS = 14 * 86_400_000;

async function userTimezone(tx: Pick<Tx, "select">, userId: string): Promise<string | null> {
  const [u] = await tx.select({ tz: users.timezone }).from(users).where(eq(users.id, userId)).limit(1);
  return u?.tz ?? null;
}

const GENERATE_ROUTE = "POST /quests/generate";
const DAILY_TARGET = 3;
/** Weekly expires at the end of local day +6, an arc at the end of local day +20. */
const EXPIRY_DAYS = { daily: 0, weekly: 6, arc: 20 } as const;

/** What the board is missing: dailies up to 3, a weekly if none, an arc if none and no active chain. */
async function questNeed(tx: Tx, userId: string, active: { type: string }[]): Promise<QuestNeed> {
  const count = (t: string) => active.filter((q) => q.type === t).length;
  return {
    daily: Math.max(0, DAILY_TARGET - count("daily")),
    weekly: count("weekly") === 0 ? 1 : 0,
    arc: count("arc") === 0 && !(await hasActiveChain(tx, userId)) ? 1 : 0,
  };
}

const boardResult = async (tx: Tx, userId: string, now: Date, generated: boolean): Promise<HandlerResult> => ({
  status: 200,
  body: { active: (await activeBoard(tx, userId, now)).map(toQuestDto), generated },
});

type GenerateStep1 =
  | { kind: "done"; result: HandlerResult }
  | { kind: "generate"; ctx: PromptContext; need: QuestNeed };

export function questsRoutes(db: Db, ai: AiDeps = {}): IRouter {
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

  /**
   * Generates today's board at most once per local day. Three steps so the model call never holds the
   * user lock (it can take seconds):
   * (1) under the lock: replay check, roll over, return the board if today already generated or nothing
   *     is missing, otherwise build the prompt context and work out what is needed;
   * (2) lock released: call the model;
   * (3) under the lock again (withIdempotency): roll over, re-check - a concurrent request may have
   *     generated meanwhile - recompute what is missing, then insert the batch record and the quests.
   */
  router.post("/quests/generate", async (req, res) => {
    generateQuestsRequestSchema.parse(req.body ?? {});
    const userId = req.user!.id;
    const now = new Date();

    const step1 = await withUserLock(db, userId, async (tx): Promise<GenerateStep1> => {
      const replay = await findReplay(tx, userId, readKey(req), GENERATE_ROUTE);
      if (replay) return { kind: "done", result: replay };
      await rollOverDue(tx, userId, now);
      const ctx = await buildUserContext(tx, userId, now);
      if (!ctx) return { kind: "done", result: { status: 409, body: { error: "Onboarding required", code: "not_onboarded" } } };
      const [batch] = await tx
        .select({ id: generatedQuestBatches.id })
        .from(generatedQuestBatches)
        .where(and(eq(generatedQuestBatches.userId, userId), eq(generatedQuestBatches.localDate, ctx.today)))
        .limit(1);
      if (batch) return { kind: "done", result: await boardResult(tx, userId, now, false) };
      const need = await questNeed(tx, userId, await activeBoard(tx, userId, now));
      if (need.daily + need.weekly + need.arc === 0) {
        return { kind: "done", result: await boardResult(tx, userId, now, false) };
      }
      return { kind: "generate", ctx, need };
    });
    if (step1.kind === "done") {
      res.status(step1.result.status).json(step1.result.body);
      return;
    }

    const { ctx } = step1;
    const generated = await generateQuestCandidates(ctx, step1.need, ai);

    await withIdempotency(db, req, res, GENERATE_ROUTE, async (tx) => {
      const at = new Date();
      await rollOverDue(tx, userId, at);
      const [batch] = await tx
        .select({ id: generatedQuestBatches.id })
        .from(generatedQuestBatches)
        .where(and(eq(generatedQuestBatches.userId, userId), eq(generatedQuestBatches.localDate, ctx.today)))
        .limit(1);
      if (batch) return boardResult(tx, userId, at, false);
      const need = await questNeed(tx, userId, await activeBoard(tx, userId, at));
      const picked = pickQuests(generated.candidates, need, ctx.weakestDomain);
      if (picked.length === 0) return boardResult(tx, userId, at, false);

      const [created] = await tx
        .insert(generatedQuestBatches)
        .values({
          userId,
          rank: ctx.rank,
          weakestDomain: ctx.weakestDomain,
          primaryGoal: ctx.primaryGoal,
          dayNumber: ctx.dayNumber,
          shadowGap: Math.round(ctx.shadowGap),
          model: generated.model,
          promptVersion: generated.promptVersion,
          attempts: generated.attempts,
          localDate: ctx.today,
        })
        .returning({ id: generatedQuestBatches.id });
      const batchId = created!.id;
      await tx.insert(generatedQuests).values(
        picked.map((q) => ({ batchId, userId, title: q.title, description: q.description, domain: q.domain, type: q.type })),
      );
      await createQuests(
        tx,
        userId,
        picked.map((q) => ({
          type: q.type,
          title: q.title,
          description: q.description,
          domain: q.domain,
          expiresAt: endOfLocalDay(addDays(ctx.today, EXPIRY_DAYS[q.type]), ctx.timezone),
          batchId,
        })),
      );
      return boardResult(tx, userId, at, true);
    });
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
