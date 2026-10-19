import { Router, type IRouter } from "express";
import { desc, eq } from "drizzle-orm";
import { profiles, rankFreezes, users, type Db } from "@workspace/db";
import { addDays, localDate } from "@workspace/engine";
import {
  FREEZE_ACTIVE_CODE,
  FREEZE_USED_CODE,
  RANK_FREEZE_DAYS,
  RankFreezeRequestSchema,
  type RankFreezeResponse,
  type RankFreezeStatus,
} from "@workspace/contracts";
import { proRequiredUnlessPro } from "../services/entitlements";
import { withIdempotency } from "../services/idempotency";
import { rollOverDue } from "../services/rollover";
import type { Tx } from "../services/user-lock";

// Rank Freeze (PRO): 7 local days (today plus 6), once per user-local calendar month. The month a freeze counts for is
// the month it STARTED in. While frozen, rollover skips decay and the demotion window pauses (see rollover.ts);
// promotion is unaffected. Pure rank mercy: it never changes a score delta, so it is not pay-to-win.

const nextMonthStart = (month: string): string => {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
};

async function userToday(tx: Pick<Tx, "select">, userId: string, now: Date): Promise<string> {
  const [u] = await tx.select({ tz: users.timezone }).from(users).where(eq(users.id, userId)).limit(1);
  return localDate(now, u?.tz ?? "UTC");
}

async function freezeState(tx: Pick<Tx, "select">, userId: string, today: string) {
  const rows = await tx
    .select({ startedOn: rankFreezes.startedOn, untilOn: rankFreezes.untilOn, month: rankFreezes.month })
    .from(rankFreezes)
    .where(eq(rankFreezes.userId, userId))
    .orderBy(desc(rankFreezes.startedOn))
    .limit(13);
  const latest = rows[0];
  const active = latest !== undefined && latest.startedOn <= today && today <= latest.untilOn;
  const month = today.slice(0, 7);
  return { active, until: active ? latest!.untilOn : null, usedThisMonth: rows.some((r) => r.month === month), month };
}

export function rankFreezeRoutes(db: Db, clock: () => Date = () => new Date()): IRouter {
  const router = Router();

  router.get("/rank-freeze", async (req, res) => {
    const userId = req.user!.id;
    const today = await userToday(db, userId, clock());
    const s = await freezeState(db, userId, today);
    const body: RankFreezeStatus = {
      active: s.active,
      until: s.until,
      usedThisMonth: s.usedThisMonth,
      availableFrom: s.usedThisMonth ? nextMonthStart(s.month) : null,
    };
    res.json(body);
  });

  router.post("/rank-freeze", async (req, res) => {
    const { reason } = RankFreezeRequestSchema.parse(req.body);
    const userId = req.user!.id;
    const now = clock();
    await withIdempotency(db, req, res, "POST /rank-freeze", async (tx) => {
      const locked = await proRequiredUnlessPro(tx, userId, now);
      if (locked) return locked;
      // Catch up pending days first: they predate the freeze and must roll unfrozen.
      await rollOverDue(tx, userId, now);
      const today = await userToday(tx, userId, now);
      const s = await freezeState(tx, userId, today);
      if (s.active) {
        return { status: 409, body: { error: "A Rank Freeze is already active", code: FREEZE_ACTIVE_CODE } };
      }
      if (s.usedThisMonth) {
        return { status: 409, body: { error: "Rank Freeze already used this month", code: FREEZE_USED_CODE } };
      }
      const until = addDays(today, RANK_FREEZE_DAYS - 1);
      await tx.insert(rankFreezes).values({ userId, startedOn: today, untilOn: until, month: s.month, reason, createdAt: now });
      await tx.update(profiles).set({ rankFreezeUntil: until, rankFreezeUsedMonth: s.month }).where(eq(profiles.userId, userId));
      const body: RankFreezeResponse = { until };
      return { status: 200, body };
    });
  });

  return router;
}
