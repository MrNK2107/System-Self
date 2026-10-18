import { Router, type IRouter } from "express";
import type { Db } from "@workspace/db";
import type { AiDeps } from "../lib/ai";
import { systemMessageRequestSchema } from "../lib/schemas";
import { findReplay, readKey, withIdempotency, type HandlerResult } from "../services/idempotency";
import { rollOverDue } from "../services/rollover";
import { buildWeeklyRecap } from "../services/recap";
import { withUserLock } from "../services/user-lock";
import { MESSAGE_PROMPT_VERSION, buildUserContext, generateMessage, type PromptContext } from "../services/ai-context";
import { getOrBuildDebrief } from "../services/debrief";
import {
  CACHED_PER_DAY,
  MESSAGE_LIMIT_RESULT,
  cachedMessage,
  messageResult,
  overMessageLimit,
  storeMessage,
} from "../services/messages";

const ROUTE = "POST /messages";

type Phase1 = { kind: "done"; result: HandlerResult } | { kind: "generate"; ctx: PromptContext };

export function messagesRoutes(db: Db, ai: AiDeps): IRouter {
  const router = Router();

  /**
   * nightly_debrief is the debrief service's text, so it always agrees with GET /debrief/today.
   * Everything else: three steps so the model call never holds the user lock (it can take seconds):
   * (1) under the lock: replay check, roll over, return today's cached message if any, enforce the daily
   *     limit, build the context;
   * (2) lock released: call the model;
   * (3) under the lock again (withIdempotency): re-check the cache and limit - a concurrent request may
   *     have won - then store and return.
   */
  router.post("/messages", async (req, res) => {
    const { type, extraContext } = systemMessageRequestSchema.parse(req.body ?? {});
    const userId = req.user!.id;
    const now = new Date();

    if (type === "nightly_debrief") {
      const out = await getOrBuildDebrief(db, userId, now, ai);
      if (out.kind === "not_onboarded") {
        res.status(409).json({ error: "Onboarding required", code: "not_onboarded" });
      } else if (out.kind === "unavailable") {
        res
          .status(409)
          .json({ error: "Debrief not available yet", code: "debrief_unavailable", availableAt: out.availableAt.toISOString() });
      } else {
        res.json({
          message: out.row.text ?? "",
          meta: { promptVersion: MESSAGE_PROMPT_VERSION, model: out.row.model ?? "template", attempts: 1 },
        });
      }
      return;
    }

    const step1 = await withUserLock(db, userId, async (tx): Promise<Phase1> => {
      const replay = await findReplay(tx, userId, readKey(req), ROUTE);
      if (replay) return { kind: "done", result: replay };
      await rollOverDue(tx, userId, now);
      const ctx = await buildUserContext(tx, userId, now);
      if (!ctx) return { kind: "done", result: { status: 409, body: { error: "Onboarding required", code: "not_onboarded" } } };
      if (CACHED_PER_DAY.has(type)) {
        const cached = await cachedMessage(tx, userId, type, ctx.today);
        if (cached) return { kind: "done", result: messageResult(cached) };
      } else if (await overMessageLimit(tx, userId, ctx.today)) {
        return { kind: "done", result: MESSAGE_LIMIT_RESULT };
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
        if (cached) return messageResult(cached);
      } else if (await overMessageLimit(tx, userId, ctx.today)) {
        return MESSAGE_LIMIT_RESULT;
      }
      await storeMessage(tx, userId, type, ctx, generated, extraContext);
      return messageResult(generated);
    });
  });

  return router;
}
