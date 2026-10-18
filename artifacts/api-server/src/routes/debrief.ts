import { Router, type IRouter } from "express";
import { and, eq, isNull } from "drizzle-orm";
import { debriefs, type Db } from "@workspace/db";
import type { RankedDomain } from "@workspace/engine";
import type { AiDeps } from "../lib/ai";
import { withIdempotency } from "../services/idempotency";
import { rollOverDue } from "../services/rollover";
import { getOrBuildDebrief } from "../services/debrief";

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

export function debriefRoutes(db: Db, ai: AiDeps): IRouter {
  const router = Router();

  router.get("/debrief/today", async (req, res) => {
    const out = await getOrBuildDebrief(db, req.user!.id, new Date(), ai);
    if (out.kind === "not_onboarded") {
      res.status(409).json({ error: "Onboarding required", code: "not_onboarded" });
    } else if (out.kind === "unavailable") {
      res.json({ available: false, availableAt: out.availableAt.toISOString() });
    } else {
      res.json({ available: true, debrief: toDto(out.row) });
    }
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
