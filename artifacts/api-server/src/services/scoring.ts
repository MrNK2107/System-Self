import { and, count, eq } from "drizzle-orm";
import {
  achievements as achievementsTable,
  domainScores,
  logs,
  milestones as milestonesTable,
  notices as noticesTable,
  quests,
  scoreEvents,
  shadowSelves,
  userDayState,
} from "@workspace/db";
import {
  ACHIEVEMENT_DEFS,
  MILESTONE_TITLES,
  RANKED_DOMAINS,
  applyDelta,
  crossedMilestones,
  newAchievements,
  type AchievementId,
  type ChangeSpec,
  type DomainState,
  type RankedDomain,
  type ShadowState,
} from "@workspace/engine";
import type { Notice } from "@workspace/contracts";
import type { Tx } from "./user-lock";

export type ScoreReason =
  | "onboarding"
  | "log"
  | "forbidden"
  | "quest_complete"
  | "quest_fail"
  | "quest_refusal"
  | "gym"
  | "streak_break"
  | "decay"
  | "challenge";

export type ScoreChange = ChangeSpec & { reason: ScoreReason; refId?: string };

export interface ApplyResult {
  results: { domain: RankedDomain; actualDelta: number; score: number; streak: number }[];
  notices: Notice[];
}

export function toShadowState(row: typeof shadowSelves.$inferSelect | undefined): ShadowState | null {
  if (!row || !row.active || !row.initialScores || !row.gainRates) return null;
  return {
    active: row.active,
    codename: row.codename,
    initialScores: row.initialScores as ShadowState["initialScores"],
    gainRates: row.gainRates as ShadowState["gainRates"],
    activatedAt: row.activatedAt ? row.activatedAt.toISOString() : null,
  };
}

function toNotice(row: typeof noticesTable.$inferSelect): Notice {
  return { id: row.id, kind: row.kind, payload: row.payload, createdAt: row.createdAt.toISOString() };
}

/**
 * Applies score changes in order for one user. Must run inside withUserLock: domain_scores rows are
 * additionally locked FOR UPDATE. Writes score_events, activity date, achievements, milestones, notices.
 */
export async function applyChanges(
  tx: Tx,
  userId: string,
  changes: ScoreChange[],
  ctx: { localDate: string; now: Date },
): Promise<ApplyResult> {
  const rows = await tx.select().from(domainScores).where(eq(domainScores.userId, userId)).for("update");
  const states = new Map<RankedDomain, DomainState>();
  for (const r of rows) {
    states.set(r.domain as RankedDomain, {
      domain: r.domain as RankedDomain,
      score: r.score,
      streak: r.streak,
      lastLogDate: r.lastLogDate,
    });
  }
  const before = new Map([...states].map(([d, s]) => [d, s.score]));
  const touched = new Set<RankedDomain>();
  const results: ApplyResult["results"] = [];
  let anyActivity = false;

  for (const c of changes) {
    const cur = states.get(c.domain);
    if (!cur) throw new Error(`No domain_scores row for ${c.domain}`);
    const { next, actualDelta } = applyDelta(cur, c.delta, {
      bonus: c.bonus,
      activity: c.activity,
      date: ctx.localDate,
    });
    states.set(c.domain, next);
    touched.add(c.domain);
    if (c.activity) anyActivity = true;
    await tx.insert(scoreEvents).values({
      userId,
      domain: c.domain,
      delta: c.delta,
      actualDelta,
      reason: c.reason,
      refId: c.refId ?? null,
      localDate: ctx.localDate,
      createdAt: ctx.now,
    });
    results.push({ domain: c.domain, actualDelta, score: next.score, streak: next.streak });
  }

  for (const d of touched) {
    const s = states.get(d)!;
    await tx
      .update(domainScores)
      .set({ score: s.score, streak: s.streak, lastLogDate: s.lastLogDate, updatedAt: ctx.now })
      .where(and(eq(domainScores.userId, userId), eq(domainScores.domain, d)));
  }
  if (anyActivity) {
    await tx.update(userDayState).set({ lastActivityDate: ctx.localDate }).where(eq(userDayState.userId, userId));
  }

  const created: (typeof noticesTable.$inferSelect)[] = [];
  const addNotice = async (kind: string, payload: unknown) => {
    const [n] = await tx.insert(noticesTable).values({ userId, kind, payload, createdAt: ctx.now }).returning();
    created.push(n!);
  };

  // Milestones: every not-yet-unlocked tier between the old and new score, per touched domain.
  const unlockedMilestones = new Set(
    (await tx.select().from(milestonesTable).where(eq(milestonesTable.userId, userId))).map(
      (m) => `${m.domain}_${m.tier}`,
    ),
  );
  for (const d of RANKED_DOMAINS) {
    if (!touched.has(d)) continue;
    const crossed = crossedMilestones(d, before.get(d)!, states.get(d)!.score, unlockedMilestones);
    for (const tier of crossed) {
      await tx.insert(milestonesTable).values({ userId, domain: d, tier, unlockedAt: ctx.now });
      await addNotice("milestone", {
        domain: d,
        tier,
        title: MILESTONE_TITLES[d][tier as 60 | 70 | 80 | 90 | 100],
      });
    }
  }

  // Achievements.
  const scores = Object.fromEntries(RANKED_DOMAINS.map((d) => [d, states.get(d)!.score])) as Record<
    RankedDomain,
    number
  >;
  const streaks = RANKED_DOMAINS.map((d) => states.get(d)!.streak);
  // Sequential: a transaction is a single connection and must not run concurrent queries.
  const [logsCount] = await tx.select({ n: count() }).from(logs).where(eq(logs.userId, userId));
  const [forbiddenLogs] = await tx
    .select({ n: count() })
    .from(logs)
    .where(and(eq(logs.userId, userId), eq(logs.forbidden, true)));
  const [completedQuests] = await tx
    .select({ n: count() })
    .from(quests)
    .where(and(eq(quests.userId, userId), eq(quests.status, "complete")));
  const shadowRows = await tx.select().from(shadowSelves).where(eq(shadowSelves.userId, userId)).limit(1);
  const unlockedRows = await tx.select().from(achievementsTable).where(eq(achievementsTable.userId, userId));
  const unlocked = new Set(unlockedRows.map((a) => a.achievementId as AchievementId));
  const fresh = newAchievements(
    {
      logsCount: logsCount!.n,
      completedQuests: completedQuests!.n,
      forbiddenLogs: forbiddenLogs!.n,
      challengeWins: 0,
      maxStreak: Math.max(...streaks),
      minStreak: Math.min(...streaks),
      scores,
      shadow: toShadowState(shadowRows[0]),
      now: ctx.now,
    },
    unlocked,
  );
  for (const id of fresh) {
    await tx.insert(achievementsTable).values({ userId, achievementId: id, unlockedAt: ctx.now });
    const def = ACHIEVEMENT_DEFS[id];
    await addNotice("achievement", { id, title: def.title, description: def.description, icon: def.icon });
  }

  return { results, notices: created.map(toNotice) };
}
