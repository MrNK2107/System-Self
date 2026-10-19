import { Router, type IRouter } from "express";
import { desc, eq } from "drizzle-orm";
import { profiles, rankFreezes, users, type Db } from "@workspace/db";
import { addDays, localDate } from "@workspace/engine";
import {
  FREEZE_ACTIVE_CODE,
  FREEZE_COOLDOWN_CODE,
  RANK_FREEZE_COOLDOWN_DAYS,
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

type Block = { code: typeof FREEZE_ACTIVE_CODE | typeof FREEZE_USED_CODE | typeof FREEZE_COOLDOWN_CODE; availableFrom: string };

/**
 * Where a freeze stands today: whether one is active and when the next POST would succeed. `availableFrom` is the
 * latest of: next local month start (this month used), the day after an active freeze, and the cooldown end (7 unfrozen
 * days after the last `until`, so `until` + 8). `block` is the refusal a POST gets now (null when it would succeed).
 */
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
  const usedThisMonth = rows.some((r) => r.month === month);
  const candidates: string[] = [];
  if (usedThisMonth) candidates.push(nextMonthStart(month));
  if (active) candidates.push(addDays(latest!.untilOn, 1));
  if (latest) candidates.push(addDays(latest.untilOn, RANK_FREEZE_COOLDOWN_DAYS + 1));
  const from = candidates.reduce((m, d) => (d > m ? d : m), "");
  const availableFrom = from > today ? from : null;
  let block: Block | null = null;
  if (availableFrom) {
    const code = active ? FREEZE_ACTIVE_CODE : usedThisMonth ? FREEZE_USED_CODE : FREEZE_COOLDOWN_CODE;
    block = { code, availableFrom };
  }
  return { active, until: active ? latest!.untilOn : null, usedThisMonth, availableFrom, block, month };
}

const BLOCK_ERROR: Record<Block["code"], string> = {
  [FREEZE_ACTIVE_CODE]: "A Rank Freeze is already active",
  [FREEZE_USED_CODE]: "Rank Freeze already used this month",
  [FREEZE_COOLDOWN_CODE]: "A Rank Freeze needs 7 unfrozen days after the last one",
};

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
      availableFrom: s.availableFrom,
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
      const [profile] = await tx.select({ userId: profiles.userId }).from(profiles).where(eq(profiles.userId, userId)).limit(1);
      if (!profile) return { status: 409, body: { error: "Onboarding required", code: "not_onboarded" } };
      // Catch up pending days first: they predate the freeze and must roll unfrozen.
      await rollOverDue(tx, userId, now);
      const today = await userToday(tx, userId, now);
      const s = await freezeState(tx, userId, today);
      if (s.block) {
        return { status: 409, body: { error: BLOCK_ERROR[s.block.code], code: s.block.code, availableFrom: s.block.availableFrom } };
      }
      const until = addDays(today, RANK_FREEZE_DAYS - 1);
      await tx.insert(rankFreezes).values({ userId, startedOn: today, untilOn: until, month: s.month, reason, createdAt: now });
      const body: RankFreezeResponse = { until };
      return { status: 200, body };
    });
  });

  return router;
}
