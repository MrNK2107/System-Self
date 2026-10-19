import { Router, type IRouter } from "express";
import { and, asc, desc, eq, gt, gte, ne } from "drizzle-orm";
import { generatedQuestBatches, generatedQuests, questChains, quests, shadowTakeovers, users, type Db } from "@workspace/db";
import {
  QUEST_COMPLETE_DELTA,
  addDays,
  chainStepQuest,
  endOfLocalDay,
  isoWeekKey,
  localDate,
  pickFloorRoutine,
  refusalOutcome,
} from "@workspace/engine";
import {
  BONUS_QUESTS_PER_DAY,
  BonusQuestRequestSchema,
  QuestRefuseRequestSchema,
  QuestShameRequestSchema,
  QuestSlotRequestSchema,
} from "@workspace/contracts";
import type { AiDeps } from "../lib/ai";
import { generateQuestsRequestSchema } from "../lib/schemas";
import { findReplay, readKey, withIdempotency, type HandlerResult } from "../services/idempotency";
import { rollOverBeforeToday } from "../services/rollover";
import { proRequiredUnlessPro } from "../services/entitlements";
import { templateBonusQuest } from "../lib/ai-fallback";
import { membershipOf } from "../services/clans";
import { abandonChain, activeBoard, createQuests, hasActiveChain, slotStateOf, toQuestDto } from "../services/quests";
import { track } from "../services/analytics";
import { applyChanges, insertNotice } from "../services/scoring";
import { applyActivityChanges } from "../services/activity";
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
const BONUS_ROUTE = "POST /quests/bonus";
/** Weekly expires at the end of local day +6, an arc at the end of local day +20. */
const EXPIRY_DAYS = { daily: 0, weekly: 6, arc: 20 } as const;

/** What the board is missing (bonus dailies never count): dailies up to 3, a weekly if none, an arc if none and no active chain. */
async function questNeed(tx: Tx, userId: string, active: { type: string; bonus: boolean }[]): Promise<QuestNeed> {
  const count = (t: string) => active.filter((q) => q.type === t && !q.bonus).length;
  return {
    daily: Math.max(0, DAILY_TARGET - count("daily")),
    weekly: count("weekly") === 0 ? 1 : 0,
    arc: count("arc") === 0 && !(await hasActiveChain(tx, userId)) ? 1 : 0,
  };
}

const boardResult = async (tx: Tx, userId: string, now: Date, generated: boolean): Promise<HandlerResult> => ({
  status: 200,
  body: { active: (await activeBoard(tx, userId, now)).map((q) => toQuestDto(q)), generated },
});

type GenerateStep1 =
  | { kind: "done"; result: HandlerResult }
  | { kind: "generate"; ctx: PromptContext; need: QuestNeed };

export function questsRoutes(db: Db, ai: AiDeps = {}, clock: () => Date = () => new Date()): IRouter {
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
    res.json({ active: active.map((q) => toQuestDto(q, slotStateOf(q, now, tz))), recent: recent.map((q) => toQuestDto(q)) });
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
      await rollOverBeforeToday(tx, userId, now);
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
      // The model call may have run past midnight: date the batch and expiries from a fresh clock.
      const at = new Date();
      await rollOverBeforeToday(tx, userId, at);
      const tz = (await userTimezone(tx, userId)) ?? ctx.timezone;
      const today = localDate(at, tz);
      const [batch] = await tx
        .select({ id: generatedQuestBatches.id })
        .from(generatedQuestBatches)
        .where(and(eq(generatedQuestBatches.userId, userId), eq(generatedQuestBatches.localDate, today)))
        .limit(1);
      if (batch) return boardResult(tx, userId, at, false);
      const need = await questNeed(tx, userId, await activeBoard(tx, userId, at));
      const picked = pickQuests(generated.candidates, need, ctx.weakestDomain, ctx.homePathActive, ctx.season !== null);
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
          localDate: today,
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
          expiresAt: endOfLocalDay(addDays(today, EXPIRY_DAYS[q.type]), tz),
          batchId,
        })),
      );
      return boardResult(tx, userId, at, true);
    });
  });

  /**
   * PRO bonus daily: up to 3 per local day, flagged `bonus`. A bonus quest has no rank effect (see countsForRank):
   * completing, failing or refusing it writes no score event. Generated like a daily (model, else a template), in
   * three steps so the model call never holds the user lock; a replay answers before the PRO check.
   */
  router.post("/quests/bonus", async (req, res) => {
    BonusQuestRequestSchema.parse(req.body ?? {});
    const userId = req.user!.id;

    /** Bonus quests created on the user's current local day. */
    const bonusToday = async (tx: Tx, tz: string, now: Date) => {
      const today = localDate(now, tz);
      const rows = await tx
        .select({ id: quests.id })
        .from(quests)
        .where(and(eq(quests.userId, userId), eq(quests.bonus, true), gt(quests.createdAt, endOfLocalDay(addDays(today, -1), tz))));
      return rows.length;
    };
    const limitReached = { status: 409, body: { error: "Bonus quest limit reached for today", code: "bonus_limit" } };

    const step1 = await withUserLock(
      db,
      userId,
      async (tx): Promise<{ kind: "done"; result: HandlerResult } | { kind: "generate"; ctx: PromptContext }> => {
        const replay = await findReplay(tx, userId, readKey(req), BONUS_ROUTE);
        if (replay) return { kind: "done", result: replay };
        const now = clock();
        const noPro = await proRequiredUnlessPro(tx, userId, now);
        if (noPro) return { kind: "done", result: noPro };
        await rollOverBeforeToday(tx, userId, now);
        const ctx = await buildUserContext(tx, userId, now);
        if (!ctx) return { kind: "done", result: { status: 409, body: { error: "Onboarding required", code: "not_onboarded" } } };
        if ((await bonusToday(tx, ctx.timezone, now)) >= BONUS_QUESTS_PER_DAY) return { kind: "done", result: limitReached };
        return { kind: "generate", ctx };
      },
    );
    if (step1.kind === "done") {
      res.status(step1.result.status).json(step1.result.body);
      return;
    }
    const { ctx } = step1;
    const generated = await generateQuestCandidates(ctx, { daily: 1, weekly: 0, arc: 0 }, ai);

    await withIdempotency(db, req, res, BONUS_ROUTE, async (tx) => {
      const now = clock();
      const noPro = await proRequiredUnlessPro(tx, userId, now);
      if (noPro) return noPro;
      await rollOverBeforeToday(tx, userId, now);
      const tz = (await userTimezone(tx, userId)) ?? ctx.timezone;
      const used = await bonusToday(tx, tz, now);
      if (used >= BONUS_QUESTS_PER_DAY) return limitReached;
      const today = localDate(now, tz);
      const board = new Set((await activeBoard(tx, userId, now)).map((q) => q.title));
      const pick =
        generated.candidates.find((q) => q.type === "daily" && !board.has(q.title)) ??
        templateBonusQuest({ weakestDomain: ctx.weakestDomain, homePathActive: ctx.homePathActive, seasonActive: ctx.season !== null }, board, used + 1);
      const [created] = await createQuests(tx, userId, [
        { type: "daily", title: pick.title, description: pick.description, domain: pick.domain, expiresAt: endOfLocalDay(today, tz), bonus: true },
      ]);
      return { status: 201, body: { quest: toQuestDto(created!), remaining: BONUS_QUESTS_PER_DAY - used - 1 } };
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
      const now = clock();
      await rollOverBeforeToday(tx, userId, now); // roll every date before today before this write lands
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
      // A bonus quest has no rank effect: no score event, no streak or activity credit. The result is still shown.
      if (done.bonus) return { status: 200, body: { quest: toQuestDto(done), results: [], notices: [] } };

      /** Advances the quest's chain: the next step, or the chain's completion notice. */
      const advanceChain = async () => {
        if (!quest.chainId) return [];
        const [chain] = await tx.select().from(questChains).where(eq(questChains.id, quest.chainId)).limit(1);
        if (!chain || chain.status !== "active") return [];
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
          return [];
        }
        await tx
          .update(questChains)
          .set({ currentStep: chain.totalSteps, status: "complete", completedAt: now })
          .where(eq(questChains.id, chain.id));
        return [await insertNotice(tx, userId, "chain_complete", { name: chain.name, templateKey: chain.templateKey }, now)];
      };

      const applied = await applyActivityChanges(
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
        { afterApply: advanceChain },
      );
      return { status: 200, body: { quest: toQuestDto(done), results: applied.results, notices: applied.notices } };
    });
  });

  /** Lock the Slot: a hand-picked HH:MM window for an active quest. It changes messages only, never when the quest fails. */
  router.patch("/quests/:id/slot", async (req, res) => {
    const questId = String(req.params.id);
    const userId = req.user!.id;
    const body = QuestSlotRequestSchema.parse(req.body ?? {});
    if (!UUID.test(questId)) {
      res.status(404).json({ error: "Quest not found" });
      return;
    }
    if (body.slotStart !== null) {
      const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
      const span = mins(body.slotEnd) - mins(body.slotStart);
      if (span <= 0 || span > 240) {
        res.status(400).json({ error: "The slot must end after it starts and last at most 4 hours", code: "invalid_slot" });
        return;
      }
    }
    await withIdempotency(db, req, res, `PATCH /quests/${questId}/slot`, async (tx) => {
      const now = clock();
      await rollOverBeforeToday(tx, userId, now);
      const [quest] = await tx
        .select()
        .from(quests)
        .where(and(eq(quests.id, questId), eq(quests.userId, userId)))
        .limit(1);
      if (!quest) return { status: 404, body: { error: "Quest not found" } };
      if (quest.status !== "active" || quest.expiresAt.getTime() <= now.getTime()) {
        return { status: 409, body: { error: "Quest is not active", code: "not_active" } };
      }
      if (quest.type !== "daily") {
        return { status: 409, body: { error: "Only daily quests take a slot", code: "slot_daily_only" } };
      }
      const slot = body.slotStart === null ? { slotStart: null, slotEnd: null } : { slotStart: body.slotStart, slotEnd: body.slotEnd };
      const [updated] = await tx
        .update(quests)
        .set(slot)
        .where(and(eq(quests.id, quest.id), eq(quests.status, "active")))
        .returning();
      if (!updated) return { status: 409, body: { error: "Quest is not active", code: "not_active" } };
      const tz = (await userTimezone(tx, userId))!;
      return { status: 200, body: { quest: toQuestDto(updated, slotStateOf(updated, now, tz)) } };
    });
  });

  /**
   * PRO Shame Mode, opt-in per quest (PRD 11): when this quest fails the clan is told its title (see rollover).
   * Enabling needs PRO and a clan; disabling is always allowed (a lapsed subscriber can turn it off).
   */
  router.patch(
    "/quests/:id/shame",
    async (req, res) => {
      const questId = String(req.params.id);
      const userId = req.user!.id;
      const body = QuestShameRequestSchema.parse(req.body ?? {});
      if (!UUID.test(questId)) {
        res.status(404).json({ error: "Quest not found" });
        return;
      }
      await withIdempotency(db, req, res, `PATCH /quests/${questId}/shame`, async (tx) => {
        const now = clock();
        if (body.enabled) {
          const noPro = await proRequiredUnlessPro(tx, userId, now);
          if (noPro) return noPro;
        }
        await rollOverBeforeToday(tx, userId, now);
        const [quest] = await tx
          .select()
          .from(quests)
          .where(and(eq(quests.id, questId), eq(quests.userId, userId)))
          .limit(1);
        if (!quest) return { status: 404, body: { error: "Quest not found" } };
        if (quest.status !== "active" || quest.expiresAt.getTime() <= now.getTime()) {
          return { status: 409, body: { error: "Quest is not active", code: "not_active" } };
        }
        if (body.enabled && quest.bonus) {
          return { status: 409, body: { error: "A bonus quest cannot use Shame Mode", code: "bonus_no_shame" } };
        }
        if (body.enabled && !(await membershipOf(tx, userId))) {
          return { status: 409, body: { error: "Join a clan to use Shame Mode", code: "not_in_clan" } };
        }
        const [updated] = await tx
          .update(quests)
          .set({ shameMode: body.enabled })
          .where(and(eq(quests.id, quest.id), eq(quests.status, "active")))
          .returning();
        if (!updated) return { status: 409, body: { error: "Quest is not active", code: "not_active" } };
        const tz = (await userTimezone(tx, userId))!;
        return { status: 200, body: { quest: toQuestDto(updated, slotStateOf(updated, now, tz)) } };
      });
    },
  );

  router.post("/quests/:id/refuse", async (req, res) => {
    const questId = String(req.params.id);
    const userId = req.user!.id;
    const parsed = QuestRefuseRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      // A missing, blank or over-long reason has its own code; anything else is an ordinary validation error.
      if (parsed.error.issues.some((i) => i.path[0] === "reason")) {
        res.status(400).json({ error: "A reason is required (1-200 characters)", code: "reason_required" });
        return;
      }
      throw parsed.error;
    }
    const body = parsed.data;
    if (!UUID.test(questId)) {
      res.status(404).json({ error: "Quest not found" });
      return;
    }
    await withIdempotency(db, req, res, `POST /quests/${questId}/refuse`, async (tx) => {
      const now = clock();
      await rollOverBeforeToday(tx, userId, now); // roll every date before today before this write lands
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

      if (quest.bonus) {
        // No rank effect: free, outside the weekly refusal allowance, no penalty, no Floor Quest, no Shadow takeover.
        const [refusedBonus] = await tx
          .update(quests)
          .set({ status: "refused", resolvedAt: now, resolvedLocalDate: today, refusalReason: body.reason })
          .where(and(eq(quests.id, quest.id), eq(quests.status, "active")))
          .returning();
        if (!refusedBonus) return { status: 409, body: { error: "Quest is not active", code: "not_active" } };
        return {
          status: 200,
          body: { quest: toQuestDto(refusedBonus), penalty: 0, results: [], notices: [], floor: null, shadowTook: null },
        };
      }

      // Refusals already used this ISO week (week boundaries follow the user timezone).
      const week = isoWeekKey(today);
      const recentRefused = await tx
        .select({ d: quests.resolvedLocalDate })
        .from(quests)
        .where(and(eq(quests.userId, userId), eq(quests.status, "refused"), eq(quests.bonus, false), gte(quests.resolvedLocalDate, addDays(today, -7))));
      const used = recentRefused.filter((r) => r.d && isoWeekKey(r.d) === week).length;
      const outcome = refusalOutcome(used);
      if (!outcome.allowed) {
        return { status: 409, body: { error: "Refusal limit reached for this week", code: "refusal_limit" } };
      }

      const [refused] = await tx
        .update(quests)
        .set({ status: "refused", resolvedAt: now, resolvedLocalDate: today, refusalReason: body.reason })
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
      // Floor Quest + Shadow takeover: a refused BODY quest gets a short routine to do now and the Shadow
      // "takes" the session. Neither touches a score; the refusal penalty above is the only score change.
      let floor: ReturnType<typeof pickFloorRoutine> | null = null;
      let shadowTook: { questTitle: string } | null = null;
      if (quest.domain === "BODY") {
        floor = pickFloorRoutine(quest.id);
        shadowTook = { questTitle: quest.title };
        await tx.insert(shadowTakeovers).values({ userId, questId: quest.id, questTitle: quest.title, localDate: today });
        await track(tx, userId, "floor_offered", { questId: quest.id, routineId: floor.id });
      }
      return {
        status: 200,
        body: {
          quest: toQuestDto(refused!),
          penalty: outcome.penalty,
          results: applied.results,
          notices: applied.notices,
          floor,
          shadowTook,
        },
      };
    });
  });

  return router;
}
