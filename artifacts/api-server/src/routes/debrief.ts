import { Router, type IRouter } from "express";
import { and, eq, isNull } from "drizzle-orm";
import { debriefs, profiles, users, type Db } from "@workspace/db";
import { localDate, type RankedDomain } from "@workspace/engine";
import type { AiDeps } from "../lib/ai";
import { withIdempotency } from "../services/idempotency";
import { rollOverDue } from "../services/rollover";
import { withUserLock } from "../services/user-lock";
import { buildUserContext, generateMessage, type DebriefFacts, type PromptContext } from "../services/ai-context";
import { computeDebriefFacts, debriefAvailableAt, templateDebriefText } from "../services/debrief";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function toDto(row: typeof debriefs.$inferSelect) {
  return {
    date: row.localDate,
    deltas: row.deltas as Record<RankedDomain, number>,
    questCompleted: row.questCompleted ?? 0,
    questTotal: row.questTotal ?? 0,
    verdict: row.verdict ?? "INSUFFICIENT",
    text: row.text ?? "",
    acknowledged: row.acknowledgedAt !== null,
  };
}

type Phase1 =
  | { kind: "done"; status: number; body: unknown }
  | { kind: "build"; today: string; ctx: PromptContext; facts: DebriefFacts };

const NOT_ONBOARDED = { kind: "done", status: 409, body: { error: "Onboarding required", code: "not_onboarded" } } as const;

export function debriefRoutes(db: Db, ai: AiDeps): IRouter {
  const router = Router();

  /**
   * Built once per local day and stored. Three steps so the model call never holds the user lock:
   * (1) under the lock: roll over, check availability, return the stored debrief or gather the facts;
   * (2) lock released: call the model; (3) under the lock again: insert (a concurrent request may have
   * won, so conflicts are ignored) and return whatever is stored.
   */
  router.get("/debrief/today", async (req, res) => {
    const userId = req.user!.id;
    const now = new Date();
    const step1 = await withUserLock(db, userId, async (tx): Promise<Phase1> => {
      await rollOverDue(tx, userId, now);
      const [row] = await tx
        .select({ tz: users.timezone, nightly: profiles.nightlyTime })
        .from(users)
        .innerJoin(profiles, eq(profiles.userId, users.id))
        .where(eq(users.id, userId))
        .limit(1);
      if (!row) return NOT_ONBOARDED;
      const today = localDate(now, row.tz);
      const availableAt = debriefAvailableAt(row.nightly, today, row.tz);
      if (now.getTime() < availableAt.getTime()) {
        return { kind: "done", status: 200, body: { available: false, availableAt: availableAt.toISOString() } };
      }
      const [existing] = await tx
        .select()
        .from(debriefs)
        .where(and(eq(debriefs.userId, userId), eq(debriefs.localDate, today)))
        .limit(1);
      if (existing) return { kind: "done", status: 200, body: { available: true, debrief: toDto(existing) } };
      const ctx = await buildUserContext(tx, userId, now);
      if (!ctx) return NOT_ONBOARDED;
      return { kind: "build", today, ctx, facts: await computeDebriefFacts(tx, userId, today) };
    });
    if (step1.kind === "done") {
      res.status(step1.status).json(step1.body);
      return;
    }

    const { today, ctx, facts } = step1;
    const generated = await generateMessage("nightly_debrief", ctx, ai, { debrief: facts }, templateDebriefText(ctx, facts));

    const stored = await withUserLock(db, userId, async (tx) => {
      await tx
        .insert(debriefs)
        .values({
          userId,
          localDate: today,
          deltas: facts.deltas,
          questCompleted: facts.questCompleted,
          questTotal: facts.questTotal,
          verdict: facts.verdict,
          text: generated.message,
          model: generated.model,
        })
        .onConflictDoNothing();
      const [row] = await tx
        .select()
        .from(debriefs)
        .where(and(eq(debriefs.userId, userId), eq(debriefs.localDate, today)))
        .limit(1);
      return row!;
    });
    res.json({ available: true, debrief: toDto(stored) });
  });

  router.post("/debrief/:date/ack", async (req, res) => {
    const date = String(req.params.date);
    if (!DATE.test(date)) {
      res.status(400).json({ error: "Invalid date", code: "invalid_date" });
      return;
    }
    const userId = req.user!.id;
    await withIdempotency(db, req, res, `POST /debrief/${date}/ack`, async (tx) => {
      const now = new Date();
      await rollOverDue(tx, userId, now);
      const updated = await tx
        .update(debriefs)
        .set({ acknowledgedAt: now })
        .where(and(eq(debriefs.userId, userId), eq(debriefs.localDate, date), isNull(debriefs.acknowledgedAt)))
        .returning({ localDate: debriefs.localDate });
      if (updated.length === 0) {
        const [exists] = await tx
          .select({ localDate: debriefs.localDate })
          .from(debriefs)
          .where(and(eq(debriefs.userId, userId), eq(debriefs.localDate, date)))
          .limit(1);
        if (!exists) return { status: 404, body: { error: "Debrief not found" } };
      }
      return { status: 204, body: undefined };
    });
  });

  return router;
}
