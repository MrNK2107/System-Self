import { and, count, eq, gt, inArray, sql } from "drizzle-orm";
import {
  achievements as achievementsTable,
  domainScores,
  logs,
  milestones as milestonesTable,
  namedChallenges,
  notices as noticesTable,
  quests,
  scoreEvents,
  shadowSelves,
  userDayState,
} from "@workspace/db";
import {
  ACHIEVEMENT_DEFS,
  DAILY_GAIN_CAP,
  LOG_DAILY_GAIN_CAP,
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
import type { Notice, NoticeKind, NoticePayload } from "@workspace/contracts";
import { notSystemLog } from "./system-logs";
import type { Tx } from "./user-lock";
import { countsForRank } from "./quests";

export type ScoreReason =
  | "onboarding"
  | "log"
  | "forbidden"
  | "quest_complete"
  | "quest_failed"
  | "quest_refusal"
  | "gym"
  | "streak_break"
  | "decay"
  | "challenge"
  | "finance_week"
  | "peer_rating"
  | "clean_day"
  | "upkeep";

export type ScoreChange = ChangeSpec & { reason: ScoreReason; refId?: string };

/** Reasons whose gains count against the per-domain daily cap (spec 6.6). Weekly evaluations are not capped. */
const DAILY_CAPPED: ScoreReason[] = ["log", "forbidden", "quest_complete", "gym", "clean_day"];
/** Unverified self-reported reasons, which also share the smaller log cap. */
const LOG_CAPPED: ScoreReason[] = ["log", "forbidden"];

/** Positive gains already taken today per domain: all capped reasons, and the self-reported share. */
async function gainsToday(tx: Tx, userId: string, localDate: string) {
  const rows = await tx
    .select({ domain: scoreEvents.domain, reason: scoreEvents.reason, total: sql<number>`sum(${scoreEvents.actualDelta})` })
    .from(scoreEvents)
    .where(
      and(
        eq(scoreEvents.userId, userId),
        eq(scoreEvents.localDate, localDate),
        gt(scoreEvents.actualDelta, 0),
        inArray(scoreEvents.reason, DAILY_CAPPED),
      ),
    )
    .groupBy(scoreEvents.domain, scoreEvents.reason);
  const all = new Map<string, number>();
  const logs = new Map<string, number>();
  for (const r of rows) {
    const t = Number(r.total) || 0;
    all.set(r.domain, (all.get(r.domain) ?? 0) + t);
    if (LOG_CAPPED.includes(r.reason as ScoreReason)) logs.set(r.domain, (logs.get(r.domain) ?? 0) + t);
  }
  return { all, logs };
}

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

/** A stored notice as sent to clients. Rows are only written via the typed helpers below, so kind and payload agree. */
export function toNotice(row: typeof noticesTable.$inferSelect): Notice {
  return { id: row.id, kind: row.kind, payload: row.payload, createdAt: row.createdAt.toISOString() } as Notice;
}

/** Inserts one notice row and returns it as a client notice. */
export async function insertNotice<K extends NoticeKind>(
  tx: Pick<Tx, "insert">,
  userId: string,
  kind: K,
  payload: NoticePayload<K>,
  now: Date,
): Promise<Notice> {
  const [n] = await tx.insert(noticesTable).values({ userId, kind, payload, createdAt: now }).returning();
  return toNotice(n!);
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

  const capped = changes.some((c) => c.delta > 0 && DAILY_CAPPED.includes(c.reason));
  const taken = capped ? await gainsToday(tx, userId, ctx.localDate) : { all: new Map<string, number>(), logs: new Map<string, number>() };

  for (const c of changes) {
    const cur = states.get(c.domain);
    if (!cur) throw new Error(`No domain_scores row for ${c.domain}`);
    let capRemaining: number | undefined;
    if (DAILY_CAPPED.includes(c.reason)) {
      capRemaining = DAILY_GAIN_CAP - (taken.all.get(c.domain) ?? 0);
      if (LOG_CAPPED.includes(c.reason)) capRemaining = Math.min(capRemaining, LOG_DAILY_GAIN_CAP - (taken.logs.get(c.domain) ?? 0));
    }
    const { next, actualDelta } = applyDelta(cur, c.delta, {
      bonus: c.bonus,
      activity: c.activity,
      date: ctx.localDate,
      capRemaining,
    });
    if (actualDelta > 0 && DAILY_CAPPED.includes(c.reason)) {
      taken.all.set(c.domain, (taken.all.get(c.domain) ?? 0) + actualDelta);
      if (LOG_CAPPED.includes(c.reason)) taken.logs.set(c.domain, (taken.logs.get(c.domain) ?? 0) + actualDelta);
    }
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
    // Only ever move forward: a backdated activity must not rewind the last-activity date.
    await tx
      .update(userDayState)
      .set({ lastActivityDate: sql`GREATEST(${userDayState.lastActivityDate}, ${ctx.localDate}::date)` })
      .where(eq(userDayState.userId, userId));
  }

  // Penalties and decay only lower scores, so nothing new can unlock: skip the scan.
  if (changes.every((c) => c.delta <= 0)) return { results, notices: [] };

  const created: Notice[] = [];
  const addNotice = async <K extends NoticeKind>(kind: K, payload: NoticePayload<K>) => {
    created.push(await insertNotice(tx, userId, kind, payload, ctx.now));
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
  const finalStates = RANKED_DOMAINS.map((d) => {
    const s = states.get(d);
    if (!s) throw new Error(`No domain_scores row for ${d}`);
    return s;
  });
  const scores = Object.fromEntries(finalStates.map((s) => [s.domain, s.score])) as Record<RankedDomain, number>;
  const streaks = finalStates.map((s) => s.streak);
  // Sequential: a transaction is a single connection and must not run concurrent queries.
  // Recurring income the rollover posts is not the user's own log (services/system-logs).
  const [logsCount] = await tx.select({ n: count() }).from(logs).where(and(eq(logs.userId, userId), notSystemLog));
  const [forbiddenLogs] = await tx
    .select({ n: count() })
    .from(logs)
    .where(and(eq(logs.userId, userId), eq(logs.forbidden, true)));
  const [completedQuests] = await tx
    .select({ n: count() })
    .from(quests)
    .where(and(eq(quests.userId, userId), eq(quests.status, "complete"), countsForRank));
  // Named challenges only; rival challenges have no score effect. Resolution sets winnerId before the win's applyChanges.
  const [challengeWins] = await tx
    .select({ n: count() })
    .from(namedChallenges)
    .where(and(eq(namedChallenges.winnerId, userId), eq(namedChallenges.status, "resolved")));
  const shadowRows = await tx.select().from(shadowSelves).where(eq(shadowSelves.userId, userId)).limit(1);
  const unlockedRows = await tx.select().from(achievementsTable).where(eq(achievementsTable.userId, userId));
  const unlocked = new Set(unlockedRows.map((a) => a.achievementId as AchievementId));
  const fresh = newAchievements(
    {
      logsCount: logsCount!.n,
      completedQuests: completedQuests!.n,
      forbiddenLogs: forbiddenLogs!.n,
      challengeWins: challengeWins!.n,
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

  return { results, notices: created };
}
