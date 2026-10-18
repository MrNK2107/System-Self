import { Router, type IRouter } from "express";
import { and, desc, eq } from "drizzle-orm";
import { systemMessages, type Db } from "@workspace/db";
import type { AiDeps } from "../lib/ai";
import { systemMessageRequestSchema } from "../lib/schemas";
import { findReplay, readKey, withIdempotency, type HandlerResult } from "../services/idempotency";
import { rollOverDue } from "../services/rollover";
import { buildWeeklyRecap } from "../services/recap";
import { withUserLock, type Tx } from "../services/user-lock";
import { buildUserContext, generateMessage, type PromptContext } from "../services/ai-context";

const ROUTE = "POST /messages";
/** Generated once per user per local day; asking again returns the stored text. */
const CACHED_PER_DAY = new Set(["morning_briefing", "nightly_debrief"]);

function cachedResult(row: typeof systemMessages.$inferSelect): HandlerResult {
  return {
    status: 200,
    body: { message: row.message, meta: { promptVersion: row.promptVersion, model: row.model, attempts: row.attempts } },
  };
}

async function cachedMessage(tx: Pick<Tx, "select">, userId: string, type: string, today: string) {
  const [row] = await tx
    .select()
    .from(systemMessages)
    .where(and(eq(systemMessages.userId, userId), eq(systemMessages.messageType, type), eq(systemMessages.localDate, today)))
    .orderBy(desc(systemMessages.id))
    .limit(1);
  return row;
}

type Phase1 = { kind: "done"; result: HandlerResult } | { kind: "generate"; ctx: PromptContext };

export function messagesRoutes(db: Db, ai: AiDeps): IRouter {
  const router = Router();

  /**
   * Three steps so the model call never holds the user lock (it can take seconds):
   * (1) under the lock: replay check, roll over, return today's cached message if any, build the context;
   * (2) lock released: call the model;
   * (3) under the lock again (withIdempotency): re-check the cache — a concurrent request may have won —
   *     then store and return.
   */
  router.post("/messages", async (req, res) => {
    const { type, extraContext } = systemMessageRequestSchema.parse(req.body ?? {});
    const userId = req.user!.id;
    const now = new Date();

    const step1 = await withUserLock(db, userId, async (tx): Promise<Phase1> => {
      const replay = await findReplay(tx, userId, readKey(req), ROUTE);
      if (replay) return { kind: "done", result: replay };
      await rollOverDue(tx, userId, now);
      const ctx = await buildUserContext(tx, userId, now);
      if (!ctx) return { kind: "done", result: { status: 409, body: { error: "Onboarding required", code: "not_onboarded" } } };
      if (CACHED_PER_DAY.has(type)) {
        const cached = await cachedMessage(tx, userId, type, ctx.today);
        if (cached) return { kind: "done", result: cachedResult(cached) };
      }
      if (type === "weekly_debrief") ctx.weeklyRecap = await buildWeeklyRecap(tx, userId, ctx.today, ctx.timezone);
      return { kind: "generate", ctx };
    });
    if (step1.kind === "done") {
      res.status(step1.result.status).json(step1.result.body);
      return;
    }

    const { ctx } = step1;
    const generated = await generateMessage(type, ctx, ai, { extraContext });

    await withIdempotency(db, req, res, ROUTE, async (tx) => {
      await rollOverDue(tx, userId, new Date());
      if (CACHED_PER_DAY.has(type)) {
        const cached = await cachedMessage(tx, userId, type, ctx.today);
        if (cached) return cachedResult(cached);
      }
      await tx.insert(systemMessages).values({
        userId,
        messageType: type,
        rank: ctx.rank,
        trajectory: ctx.trajectory,
        shadowActive: ctx.shadowActive,
        shadowGap: Math.round(ctx.shadowGap),
        dayNumber: ctx.dayNumber,
        message: generated.message,
        model: generated.model,
        promptVersion: generated.promptVersion,
        attempts: generated.attempts,
        localDate: ctx.today,
        context: {
          scores: ctx.scores,
          activeQuests: ctx.activeQuests,
          completedToday: ctx.completedToday,
          weakestDomain: ctx.weakestDomain,
          primaryGoal: ctx.primaryGoal,
          extraContext: extraContext ?? null,
        },
      });
      return {
        status: 200,
        body: {
          message: generated.message,
          meta: { promptVersion: generated.promptVersion, model: generated.model, attempts: generated.attempts },
        },
      };
    });
  });

  return router;
}
