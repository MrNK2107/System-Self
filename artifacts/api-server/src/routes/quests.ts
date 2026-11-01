import { Router, type IRouter } from "express";
import { and, asc, count, desc, eq, gt, gte, inArray, ne, or } from "drizzle-orm";
import {
  follows,
  generatedQuestBatches,
  generatedQuests,
  profiles,
  questChains,
  questProofs,
  quests,
  shadowTakeovers,
  users,
  vouchRequests,
  type Db,
} from "@workspace/db";
import {
  RANKED_DOMAINS,
  addDays,
  cleanDayChange,
  QUIZ_LENGTH,
  VOUCH_CHAIN_MAX_DEPTH,
  VOUCH_REQUEST_TTL_MS,
  needsSessionProof,
  vouchAllowed,
  type DayProof,
  questCompletionChanges,
  studyMinutesRequired,
  verifyStudy,
  verifyWorkout,
  type QuestDifficulty,
  type QuizKey,
  type QuizQuestion,
  type QuestTarget,
  type RankedDomain,
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
  QuizAnswerRequestSchema,
  VouchCreateRequestSchema,
  VouchRespondRequestSchema,
  SessionProofRequestSchema,
  type SessionSummaryDto,
} from "@workspace/contracts";
import type { AiDeps } from "../lib/ai";
import { generateQuestsRequestSchema } from "../lib/schemas";
import { findReplay, readKey, withIdempotency, type HandlerResult } from "../services/idempotency";
import { rollOverBeforeToday } from "../services/rollover";
import { proRequiredUnlessPro } from "../services/entitlements";
import { templateBonusQuest } from "../lib/ai-fallback";
import { membershipOf } from "../services/clans";
import { duoOf } from "../services/duo";
import { isBlockedEitherWay, resolveHandle } from "../services/social";
import { placeForUser, recordSpotAndLearn } from "../services/places";
import { buildQuiz, gradeQuiz, type QuizAnswer } from "../services/quiz";
import { abandonChain, activeBoard, createQuests, hasActiveChain, isCleanDay, slotStateOf, toQuestDto } from "../services/quests";
import { track } from "../services/analytics";
import { applyChanges, insertNotice, type ScoreChange } from "../services/scoring";
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

  /**
   * Marks an active quest complete and scores it: the base to its own domain plus DISCIPLINE, the clean-day bonus,
   * and the chain's next step. Shared by tap-to-complete and a proven live session. Must run inside withUserLock.
   */
  async function finishQuest(
    tx: Tx,
    userId: string,
    quest: typeof quests.$inferSelect,
    now: Date,
    today: string,
  ): Promise<HandlerResult> {
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

    // The base goes to the quest's own domain (spec 6.2), plus DISCIPLINE for keeping the commitment.
    const domain: RankedDomain = (RANKED_DOMAINS as readonly string[]).includes(quest.domain)
      ? (quest.domain as RankedDomain)
      : "DISCIPLINE";
    const changes: ScoreChange[] = questCompletionChanges(domain, (quest.difficulty ?? "normal") as QuestDifficulty).map(
      (c) => ({ ...c, reason: "quest_complete" as const, refId: quest.id }),
    );
    if (quest.type === "daily" && (await isCleanDay(tx, userId, today, now))) {
      changes.push({ ...cleanDayChange(), reason: "clean_day" });
    }
    const applied = await applyActivityChanges(
      tx,
      userId,
      changes,
      { localDate: today, now },
      { afterApply: advanceChain },
    );
    return { status: 200, body: { quest: toQuestDto(done), results: applied.results, notices: applied.notices } };
  }

  /** Weekly/arc quests count accepted proofs; returns { done, needed } for the quest. */
  async function proofProgress(tx: Tx, questId: string, target: QuestTarget) {
    const [accepted] = await tx
      .select({ done: count() })
      .from(questProofs)
      .where(and(eq(questProofs.questId, questId), eq(questProofs.status, "accepted")));
    return { done: Number(accepted?.done ?? 0), needed: target.sessions ?? 1 };
  }

  const proofDtoOf = (p: typeof questProofs.$inferSelect) => ({
    id: p.id,
    questId: p.questId,
    method: p.method as "session",
    status: p.status as "accepted" | "rejected" | "awaiting_quiz" | "awaiting_review",
    reason: p.reason,
    evidence: (p.evidence ?? []) as string[],
    createdAt: p.createdAt.toISOString(),
  });

  /** After a proof is judged: completes the quest when it has every session it needs, else reports progress. */
  async function settleProof(
    tx: Tx,
    userId: string,
    quest: typeof quests.$inferSelect,
    target: QuestTarget,
    proof: typeof questProofs.$inferSelect,
    now: Date,
  ): Promise<HandlerResult> {
    const { done, needed } = await proofProgress(tx, quest.id, target);
    const progress = needed > 1 ? { done, needed } : null;
    if (proof.status === "accepted" && done >= needed && quest.status === "active") {
      const tz = (await userTimezone(tx, userId))!;
      const finished = await finishQuest(tx, userId, quest, now, localDate(now, tz));
      if (finished.status !== 200) return finished;
      const b = finished.body as { quest: unknown; results: unknown[]; notices: unknown[] };
      return {
        status: 200,
        body: { proof: proofDtoOf(proof), quest: b.quest, completed: true, progress, results: b.results, notices: b.notices, quiz: null },
      };
    }
    return {
      status: 200,
      body: { proof: proofDtoOf(proof), quest: toQuestDto(quest), completed: false, progress, results: [], notices: [], quiz: null },
    };
  }

  /** How long the phone has to answer a study quiz after the session ends. */
  const QUIZ_TTL_MS = 2 * 3600_000;

  /**
   * A study session (spec 8.5): too short is rejected at once; otherwise a quiz on the topic is built (AI, then the
   * stored bank, then explain-in-your-own-words) and kept with its answer key on the proof, awaiting the answers.
   */
  async function startStudyProof(
    tx: Tx,
    userId: string,
    quest: typeof quests.$inferSelect,
    target: QuestTarget,
    summary: SessionSummaryDto,
    clientId: string | null,
    now: Date,
  ): Promise<HandlerResult> {
    const topic = summary.topic?.trim() || quest.title;
    const minutes = (Date.parse(summary.endedAt) - Date.parse(summary.startedAt)) / 60000;
    if (summary.mocked || minutes < studyMinutesRequired(target)) {
      const v = verifyStudy(summary, target, { correct: 0, total: QUIZ_LENGTH }, topic);
      const [proof] = await tx
        .insert(questProofs)
        .values({
          questId: quest.id,
          userId,
          method: "session",
          status: "rejected",
          summary,
          reason: v.reason,
          evidence: v.evidence,
          clientId,
          createdAt: now,
        })
        .returning();
      return settleProof(tx, userId, quest, target, proof!, now);
    }
    const quiz = await buildQuiz(topic, ai);
    const expiresAt = new Date(now.getTime() + QUIZ_TTL_MS);
    const [proof] = await tx
      .insert(questProofs)
      .values({
        questId: quest.id,
        userId,
        method: "session",
        status: "awaiting_quiz",
        summary: { ...summary, topic, quiz, quizExpiresAt: expiresAt.toISOString() },
        reason: "Answer THE SYSTEM's questions to prove you studied.",
        evidence: [`${Math.round(minutes)} min on ${topic}`],
        clientId,
        createdAt: now,
      })
      .returning();
    const base = await settleProof(tx, userId, quest, target, proof!, now);
    return {
      ...base,
      body: {
        ...(base.body as object),
        quiz: { proofId: proof!.id, source: quiz.source, questions: quiz.questions, expiresAt: expiresAt.toISOString() },
      },
    };
  }

  /** Grades a stored study quiz and records the verdict (or keeps it awaiting AI review). */
  async function judgeStudyQuiz(
    tx: Tx,
    userId: string,
    proof: typeof questProofs.$inferSelect,
    answers: QuizAnswer[],
    now: Date,
  ): Promise<HandlerResult> {
    const [quest] = await tx.select().from(quests).where(eq(quests.id, proof.questId)).limit(1);
    if (!quest) return { status: 404, body: { error: "Quest not found" } };
    const target = quest.target as QuestTarget;
    const stored = proof.summary as SessionSummaryDto & {
      topic: string;
      quiz: { questions: QuizQuestion[]; keys: QuizKey[] };
    };
    const graded = await gradeQuiz(stored.topic, stored.quiz.questions, stored.quiz.keys, answers, ai);
    if (graded.pendingReview) {
      const [updated] = await tx
        .update(questProofs)
        .set({
          status: "awaiting_review",
          summary: { ...stored, answers },
          reason: "THE SYSTEM will grade your explanation when it is back. The quest stays open until then.",
        })
        .where(eq(questProofs.id, proof.id))
        .returning();
      return settleProof(tx, userId, quest, target, updated!, now);
    }
    const v = verifyStudy(stored, target, { correct: graded.correct, total: graded.total }, stored.topic);
    const [updated] = await tx
      .update(questProofs)
      .set({ status: v.ok ? "accepted" : "rejected", summary: { ...stored, answers }, reason: v.reason, evidence: v.evidence })
      .where(eq(questProofs.id, proof.id))
      .returning();
    return settleProof(tx, userId, quest, target, updated!, now);
  }

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
      if (!quest.bonus && needsSessionProof(quest.target as QuestTarget | null)) {
        return { status: 409, body: { error: "This quest is proven by a live session.", code: "proof_required" } };
      }
      return finishQuest(tx, userId, quest, now, today);
    });
  });

  /**
   * A finished live session as proof (spec 8.2). The server re-judges the summary (engine verifyWorkout) and records
   * the proof either way. When accepted and the quest has all the sessions it needs, the quest completes here.
   */
  router.post("/quests/:id/session", async (req, res) => {
    const questId = String(req.params.id);
    const userId = req.user!.id;
    if (!UUID.test(questId)) {
      res.status(404).json({ error: "Quest not found" });
      return;
    }
    const parsed = SessionProofRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid session summary", code: "invalid_session" });
      return;
    }
    const { summary, clientId } = parsed.data;
    await withIdempotency(db, req, res, `POST /quests/${questId}/session`, async (tx) => {
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
      const target = quest.target as QuestTarget | null;
      if (!target || !needsSessionProof(target)) {
        return { status: 409, body: { error: "This quest is not proven by a session.", code: "not_session_quest" } };
      }
      if ((target.kind === "study") !== (summary.kind === "study")) {
        return { status: 409, body: { error: "Wrong kind of session for this quest.", code: "not_session_quest" } };
      }
      if (target.kind === "study") return startStudyProof(tx, userId, quest, target, summary, clientId ?? null, now);
      const place = summary.placeId ? await placeForUser(tx, userId, summary.placeId) : null;
      const verdict = verifyWorkout(summary, target, place);
      const [proof] = await tx
        .insert(questProofs)
        .values({
          questId: quest.id,
          userId,
          method: "session",
          status: verdict.ok ? "accepted" : "rejected",
          summary,
          reason: verdict.reason,
          evidence: verdict.evidence,
          clientId: clientId ?? null,
          createdAt: now,
        })
        .returning();
      // Teach the map: a session proven by movement marks its coarse spot (a still phone proves nothing about a place).
      if (verdict.ok && summary.coarse && summary.activeMinutes >= target.value) {
        await recordSpotAndLearn(tx, userId, "gym", summary.coarse, now);
      }
      const needed = target.sessions ?? 1;
      const [accepted] = await tx
        .select({ done: count() })
        .from(questProofs)
        .where(and(eq(questProofs.questId, quest.id), eq(questProofs.status, "accepted")));
      const done = Number(accepted?.done ?? 0);
      const proofDto = {
        id: proof!.id,
        questId: quest.id,
        method: "session" as const,
        status: proof!.status as "accepted" | "rejected",
        reason: proof!.reason,
        evidence: verdict.evidence,
        createdAt: proof!.createdAt.toISOString(),
      };
      const progress = needed > 1 ? { done, needed } : null;
      if (verdict.ok && done >= needed) {
        const tz = (await userTimezone(tx, userId))!;
        const finished = await finishQuest(tx, userId, quest, now, localDate(now, tz));
        if (finished.status !== 200) return finished;
        const b = finished.body as { quest: unknown; results: unknown[]; notices: unknown[] };
        return {
          status: 200,
          body: { proof: proofDto, quest: b.quest, completed: true, progress, results: b.results, notices: b.notices },
        };
      }
      return {
        status: 200,
        body: { proof: proofDto, quest: toQuestDto(quest), completed: false, progress, results: [], notices: [] },
      };
    });
  });

  /** Answers to a study session's quiz (spec 8.5). Within 2 h of the session; graded by key, AI, or later review. */
  router.post("/proofs/:id/quiz", async (req, res) => {
    const proofId = String(req.params.id);
    const userId = req.user!.id;
    const body = QuizAnswerRequestSchema.safeParse(req.body ?? {});
    if (!UUID.test(proofId) || !body.success) {
      res.status(400).json({ error: "Invalid answers", code: "invalid_answers" });
      return;
    }
    await withIdempotency(db, req, res, `POST /proofs/${proofId}/quiz`, async (tx) => {
      const now = clock();
      const [proof] = await tx
        .select()
        .from(questProofs)
        .where(and(eq(questProofs.id, proofId), eq(questProofs.userId, userId)))
        .limit(1);
      if (!proof) return { status: 404, body: { error: "Proof not found" } };
      if (proof.status !== "awaiting_quiz") {
        return { status: 409, body: { error: "This quiz was already answered.", code: "quiz_closed" } };
      }
      const exp = Date.parse((proof.summary as { quizExpiresAt?: string }).quizExpiresAt ?? "");
      if (!(exp > now.getTime())) {
        await tx
          .update(questProofs)
          .set({ status: "rejected", reason: "The quiz expired before you answered." })
          .where(eq(questProofs.id, proof.id));
        return { status: 409, body: { error: "The quiz expired. Start a new session.", code: "quiz_expired" } };
      }
      return judgeStudyQuiz(tx, userId, proof, body.data.answers, now);
    });
  });

  /** Re-tries grading an answer that was waiting for the AI. Still pending when the AI is still down. */
  router.post("/proofs/:id/review", async (req, res) => {
    const proofId = String(req.params.id);
    const userId = req.user!.id;
    if (!UUID.test(proofId)) {
      res.status(404).json({ error: "Proof not found" });
      return;
    }
    await withIdempotency(db, req, res, `POST /proofs/${proofId}/review`, async (tx) => {
      const now = clock();
      const [proof] = await tx
        .select()
        .from(questProofs)
        .where(and(eq(questProofs.id, proofId), eq(questProofs.userId, userId)))
        .limit(1);
      if (!proof) return { status: 404, body: { error: "Proof not found" } };
      if (proof.status !== "awaiting_review") {
        return { status: 409, body: { error: "Nothing to review.", code: "not_pending" } };
      }
      const answers = ((proof.summary as { answers?: QuizAnswer[] }).answers ?? []) as QuizAnswer[];
      return judgeStudyQuiz(tx, userId, proof, answers, now);
    });
  });

  /** Today's accepted proofs for a vouch chain: the voucher, then whoever vouched for them, up to the depth limit. */
  async function dayProofsFrom(tx: Tx, rootId: string, now: Date): Promise<Map<string, DayProof[]>> {
    const since = new Date(now.getTime() - 24 * 3600_000);
    const out = new Map<string, DayProof[]>();
    let frontier = [rootId];
    for (let depth = 0; depth < VOUCH_CHAIN_MAX_DEPTH && frontier.length > 0; depth++) {
      const rows = await tx
        .select({ userId: questProofs.userId, method: questProofs.method, summary: questProofs.summary })
        .from(questProofs)
        .where(and(inArray(questProofs.userId, frontier), eq(questProofs.status, "accepted"), gt(questProofs.createdAt, since)));
      const next: string[] = [];
      for (const id of frontier) if (!out.has(id)) out.set(id, []);
      for (const r of rows) {
        const voucherId = r.method === "vouch" ? (r.summary as { voucherId?: string }).voucherId : undefined;
        const p: DayProof = voucherId ? { direct: false, voucherId } : { direct: true };
        out.get(r.userId)!.push(p);
        if (voucherId && !out.has(voucherId)) next.push(voucherId);
      }
      frontier = [...new Set(next)];
    }
    return out;
  }

  /** True when the two players are in the same clan, a duo together, or follow each other. */
  async function closeEnoughToVouch(tx: Tx, a: string, b: string): Promise<boolean> {
    const [ma, mb] = [await membershipOf(tx, a), await membershipOf(tx, b)];
    if (ma && mb && ma.clanId === mb.clanId) return true;
    if ((await duoOf(tx, a))?.partnerId === b) return true;
    const mutual = await tx
      .select({ f: follows.followerId })
      .from(follows)
      .where(or(and(eq(follows.followerId, a), eq(follows.followeeId, b)), and(eq(follows.followerId, b), eq(follows.followeeId, a))));
    return mutual.length === 2;
  }

  /** Ask a friend to vouch (spec 8.6): a clan member, duo partner or mutual follow, at most 3 open asks per quest. */
  router.post("/quests/:id/vouch", async (req, res) => {
    const questId = String(req.params.id);
    const userId = req.user!.id;
    const body = VouchCreateRequestSchema.safeParse(req.body ?? {});
    if (!UUID.test(questId) || !body.success) {
      res.status(400).json({ error: "A handle and a short note are required", code: "invalid_vouch" });
      return;
    }
    await withIdempotency(db, req, res, `POST /quests/${questId}/vouch`, async (tx) => {
      const now = clock();
      const [quest] = await tx
        .select()
        .from(quests)
        .where(and(eq(quests.id, questId), eq(quests.userId, userId)))
        .limit(1);
      if (!quest) return { status: 404, body: { error: "Quest not found" } };
      if (quest.status !== "active" || quest.expiresAt.getTime() <= now.getTime() || quest.bonus) {
        return { status: 409, body: { error: "Quest is not active", code: "not_active" } };
      }
      const player = await resolveHandle(tx, userId, body.data.handle);
      if (!player || player.self) return { status: 404, body: { error: "Player not found", code: "not_found" } };
      if ((await isBlockedEitherWay(tx, userId, player.userId)) || !(await closeEnoughToVouch(tx, userId, player.userId))) {
        return {
          status: 409,
          body: { error: "Only a clanmate, your duo partner or someone you follow back can vouch for you.", code: "not_close" },
        };
      }
      const since = new Date(now.getTime() - VOUCH_REQUEST_TTL_MS);
      const open = await tx
        .select({ voucherId: vouchRequests.voucherId })
        .from(vouchRequests)
        .where(and(eq(vouchRequests.questId, quest.id), eq(vouchRequests.status, "pending"), gt(vouchRequests.createdAt, since)));
      if (open.some((o) => o.voucherId === player.userId)) {
        return { status: 409, body: { error: "Already asked. Wait for their answer.", code: "already_asked" } };
      }
      if (open.length >= 3) return { status: 409, body: { error: "Three asks are already open for this quest.", code: "too_many_asks" } };
      const [row] = await tx
        .insert(vouchRequests)
        .values({ questId: quest.id, requesterId: userId, voucherId: player.userId, note: body.data.note, createdAt: now })
        .returning();
      return {
        status: 201,
        body: {
          request: {
            id: row!.id,
            status: "pending",
            createdAt: row!.createdAt.toISOString(),
            expiresAt: new Date(row!.createdAt.getTime() + VOUCH_REQUEST_TTL_MS).toISOString(),
          },
        },
      };
    });
  });

  /** Vouch requests waiting for me, newest first (the requester by public codename only). */
  router.get("/vouches/incoming", async (req, res) => {
    const userId = req.user!.id;
    const now = clock();
    const rows = await db
      .select({
        id: vouchRequests.id,
        note: vouchRequests.note,
        createdAt: vouchRequests.createdAt,
        questTitle: quests.title,
        questStatus: quests.status,
        from: profiles.publicCodename,
      })
      .from(vouchRequests)
      .innerJoin(quests, eq(quests.id, vouchRequests.questId))
      .innerJoin(profiles, eq(profiles.userId, vouchRequests.requesterId))
      .where(
        and(
          eq(vouchRequests.voucherId, userId),
          eq(vouchRequests.status, "pending"),
          gt(vouchRequests.createdAt, new Date(now.getTime() - VOUCH_REQUEST_TTL_MS)),
        ),
      )
      .orderBy(desc(vouchRequests.createdAt))
      .limit(20);
    res.json({
      items: rows
        .filter((r) => r.questStatus === "active")
        .map((r) => ({
          id: r.id,
          from: r.from,
          questTitle: r.questTitle,
          note: r.note,
          createdAt: r.createdAt.toISOString(),
          expiresAt: new Date(r.createdAt.getTime() + VOUCH_REQUEST_TTL_MS).toISOString(),
        })),
    });
  });

  /** Confirm or deny a vouch. Confirming needs your own quest proven today (directly or through a vouch chain). */
  router.post("/vouches/:id/respond", async (req, res) => {
    const requestId = String(req.params.id);
    const userId = req.user!.id;
    const body = VouchRespondRequestSchema.safeParse(req.body ?? {});
    if (!UUID.test(requestId) || !body.success) {
      res.status(400).json({ error: "confirm is required", code: "invalid_vouch" });
      return;
    }
    await withIdempotency(db, req, res, `POST /vouches/${requestId}/respond`, async (tx) => {
      const now = clock();
      const [vr] = await tx
        .select()
        .from(vouchRequests)
        .where(and(eq(vouchRequests.id, requestId), eq(vouchRequests.voucherId, userId)))
        .limit(1);
      if (!vr) return { status: 404, body: { error: "Request not found", code: "not_found" } };
      if (vr.status !== "pending" || now.getTime() - vr.createdAt.getTime() > VOUCH_REQUEST_TTL_MS) {
        return { status: 409, body: { error: "This request is closed.", code: "closed" } };
      }
      if (!body.data.confirm) {
        await tx.update(vouchRequests).set({ status: "denied", respondedAt: now }).where(eq(vouchRequests.id, vr.id));
        return { status: 200, body: { status: "denied", completed: false } };
      }
      const weekAgo = new Date(now.getTime() - 7 * 86_400_000);
      const confirmed = await tx
        .select({ requesterId: vouchRequests.requesterId })
        .from(vouchRequests)
        .where(and(eq(vouchRequests.voucherId, userId), eq(vouchRequests.status, "confirmed"), gt(vouchRequests.respondedAt, weekAgo)));
      const verdict = vouchAllowed({
        voucherId: userId,
        requesterId: vr.requesterId,
        confirmationsThisWeek: confirmed.length,
        pairConfirmationsThisWeek: confirmed.filter((c) => c.requesterId === vr.requesterId).length,
        proofs: await dayProofsFrom(tx, userId, now),
      });
      if (!verdict.ok) {
        const msg = {
          voucher_unproven: "Prove your own quest today first. Only the proven can vouch.",
          weekly_limit: "You have vouched 3 times this week. That is the limit.",
          pair_limit: "You already vouched for this player this week.",
          self: "You can't vouch for yourself.",
        }[verdict.code];
        return { status: 409, body: { error: msg, code: verdict.code } };
      }
      const [quest] = await tx.select().from(quests).where(eq(quests.id, vr.questId)).limit(1);
      if (!quest || quest.status !== "active") return { status: 409, body: { error: "That quest is closed.", code: "closed" } };
      await tx.update(vouchRequests).set({ status: "confirmed", respondedAt: now }).where(eq(vouchRequests.id, vr.id));
      const [me] = await tx.select({ codename: profiles.publicCodename }).from(profiles).where(eq(profiles.userId, userId)).limit(1);
      const [proof] = await tx
        .insert(questProofs)
        .values({
          questId: quest.id,
          userId: vr.requesterId,
          method: "vouch",
          status: "accepted",
          summary: { voucherId: userId, note: vr.note, requestId: vr.id },
          reason: `Vouched for by ${me?.codename ?? "a clanmate"}.`,
          evidence: [`vouched by ${me?.codename ?? "a clanmate"}`],
          createdAt: now,
        })
        .returning();
      const target = (quest.target ?? { kind: "social_meet", metric: "count", value: 1, unit: "times" }) as QuestTarget;
      const settled = await settleProof(tx, vr.requesterId, quest, target, proof!, now);
      const completed = settled.status === 200 && (settled.body as { completed?: boolean }).completed === true;
      return { status: 200, body: { status: "confirmed", completed } };
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
