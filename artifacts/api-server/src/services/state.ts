import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import {
  achievements,
  dailySnapshots,
  domainScores,
  milestones,
  notices,
  profiles,
  quests,
  shadowSelves,
  users,
  type Db,
} from "@workspace/db";
import {
  RANKED_DOMAINS,
  addDays,
  completionMultiplier,
  daysBetween,
  hiddenScore,
  localDate,
  shadowGap,
  shadowPhase,
  shadowRank,
  shadowScores,
  tierProgress,
  trajectory,
  uiState as computeUiState,
  type Rank,
  type RankedDomain,
} from "@workspace/engine";
import { NOTICE_PAGE_SIZE, type GameState, type Notice, type NoticeKind } from "@workspace/contracts";
import { toNotice, toShadowState } from "./scoring";
import { currentSeasons } from "./seasons";
import { countsForRank } from "./quests";
import { isPro } from "./entitlements";
import { reads } from "../lib/reads";

/**
 * The oldest NOTICE_PAGE_SIZE unseen notices, and whether more are waiting. With `kinds` only those kinds are
 * returned and paged (an empty list matches nothing), so a client never starves on kinds it cannot render.
 */
export async function unseenNotices(
  db: Pick<Db, "select">,
  userId: string,
  kinds?: readonly NoticeKind[],
): Promise<{ items: Notice[]; hasMore: boolean }> {
  if (kinds && kinds.length === 0) return { items: [], hasMore: false };
  const rows = await db
    .select()
    .from(notices)
    .where(
      and(eq(notices.userId, userId), isNull(notices.seenAt), kinds ? inArray(notices.kind, [...kinds]) : undefined),
    )
    .orderBy(asc(notices.createdAt), asc(notices.id))
    .limit(NOTICE_PAGE_SIZE + 1);
  return { items: rows.slice(0, NOTICE_PAGE_SIZE).map(toNotice), hasMore: rows.length > NOTICE_PAGE_SIZE };
}

export type Trajectory = "up" | "stable" | "down";

/** The newest 30 snapshots of each of many users. */
function recentSnapshotsOf(db: Pick<Db, "select">, ids: string[]) {
  const ranked = db
    .select({
      userId: dailySnapshots.userId,
      date: dailySnapshots.localDate,
      hidden: dailySnapshots.hidden,
      rn: sql<number>`row_number() over (partition by ${dailySnapshots.userId} order by ${dailySnapshots.localDate} desc)`.as("rn"),
    })
    .from(dailySnapshots)
    .where(inArray(dailySnapshots.userId, ids))
    .as("ranked");
  return db.select({ userId: ranked.userId, date: ranked.date, hidden: ranked.hidden }).from(ranked).where(lte(ranked.rn, 30));
}

/**
 * Hidden score (server-side only: callers must never put it in a response) and 7-day trajectory for many users
 * in a constant number of queries (one for resolved quests, one for the newest 30 snapshots of each user).
 * Each user is judged on their own `today`. Shared by the game state and the social projections.
 */
export async function hiddenAndTrajectoryBatch(
  db: Pick<Db, "select">,
  entries: readonly { userId: string; today: string; scoreMap: Record<RankedDomain, number> }[],
): Promise<Map<string, { hidden: number; trajectory: Trajectory }>> {
  const out = new Map<string, { hidden: number; trajectory: Trajectory }>();
  if (entries.length === 0) return out;
  const ids = entries.map((e) => e.userId);
  const earliest = entries.map((e) => addDays(e.today, -29)).sort()[0]!;

  const resolvedQuery = db
    .select({ userId: quests.userId, status: quests.status, day: quests.resolvedLocalDate })
    .from(quests)
    .where(
      and(
        inArray(quests.userId, ids),
        countsForRank,
        inArray(quests.status, ["complete", "failed", "refused"]),
        gte(quests.resolvedLocalDate, earliest),
      ),
    );
  // One user (the game state): an index range read of the newest 30, independent of how long the history is.
  const recentQuery =
    ids.length === 1
      ? db
          .select({ userId: dailySnapshots.userId, date: dailySnapshots.localDate, hidden: dailySnapshots.hidden })
          .from(dailySnapshots)
          .where(eq(dailySnapshots.userId, ids[0]!))
          .orderBy(desc(dailySnapshots.localDate))
          .limit(30)
      : recentSnapshotsOf(db, ids);
  const [resolved, recent] = await reads(db, [() => resolvedQuery, () => recentQuery]);

  // Grouped by user once, so a batch of N users costs O(rows), not O(N x rows).
  const group = <T extends { userId: string }>(rows: readonly T[]) => {
    const m = new Map<string, T[]>();
    for (const r of rows) {
      const list = m.get(r.userId);
      if (list) list.push(r);
      else m.set(r.userId, [r]);
    }
    return m;
  };
  const resolvedBy = group(resolved);
  const recentBy = group(recent);

  for (const e of entries) {
    const since = addDays(e.today, -29);
    const mine = (resolvedBy.get(e.userId) ?? []).filter((q) => q.day !== null && q.day >= since);
    const completed = mine.filter((q) => q.status === "complete").length;
    const hidden = hiddenScore(e.scoreMap, completionMultiplier(mine.length, completed));
    const snapshots = [...(recentBy.get(e.userId) ?? [])]
      .sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0))
      .map((r) => ({ date: r.date, hidden: r.hidden }));
    out.set(e.userId, { hidden, trajectory: trajectory(snapshots, hidden) });
  }
  return out;
}

/** The user's hidden score (never in a response) and trajectory. */
export async function hiddenAndTrajectory(
  db: Pick<Db, "select">,
  userId: string,
  today: string,
  scoreMap: Record<RankedDomain, number>,
): Promise<{ hidden: number; trajectory: Trajectory }> {
  const r = (await hiddenAndTrajectoryBatch(db, [{ userId, today, scoreMap }])).get(userId);
  return r!;
}

/** Builds the client-facing game state. The hidden score is used internally but never included. */
export async function buildGameState(
  db: Pick<Db, "select">,
  userId: string,
  now: Date,
  opts: { noticeKinds?: readonly NoticeKind[] } = {},
): Promise<GameState | null> {
  // Independent reads go out together on the pool (GET /state); inside a transaction they run one by one (see reads).
  const [[user], [profile], rows, [shadowRow], unseen, achievementRows, milestoneRows, pro] = await reads(db, [
    () => db.select().from(users).where(eq(users.id, userId)).limit(1),
    () => db.select().from(profiles).where(eq(profiles.userId, userId)).limit(1),
    () => db.select().from(domainScores).where(eq(domainScores.userId, userId)),
    () => db.select().from(shadowSelves).where(eq(shadowSelves.userId, userId)).limit(1),
    () => unseenNotices(db, userId, opts.noticeKinds),
    () =>
      db
        .select()
        .from(achievements)
        .where(eq(achievements.userId, userId))
        .orderBy(asc(achievements.unlockedAt), asc(achievements.achievementId)),
    () =>
      db
        .select()
        .from(milestones)
        .where(eq(milestones.userId, userId))
        .orderBy(asc(milestones.unlockedAt), asc(milestones.domain), asc(milestones.tier)),
    () => isPro(db, userId, now),
  ]);
  if (!user || !profile) return null;

  const today = localDate(now, user.timezone);
  const byDomain = new Map(rows.map((r) => [r.domain, r]));
  const scores = RANKED_DOMAINS.map((d) => {
    const r = byDomain.get(d);
    return { domain: d, score: r?.score ?? 0, streak: r?.streak ?? 0, lastLogDate: r?.lastLogDate ?? null };
  });
  const scoreMap = Object.fromEntries(scores.map((s) => [s.domain, s.score])) as Record<RankedDomain, number>;

  const [{ hidden, trajectory: trend }, { active: season }] = await reads(db, [
    () => hiddenAndTrajectory(db, userId, today, scoreMap),
    () => currentSeasons(db, userId, today),
  ]);

  const shadowState = toShadowState(shadowRow);
  let shadow: GameState["shadow"] = null;
  if (shadowState) {
    const gap = shadowGap(shadowState, scoreMap, now);
    shadow = {
      active: true,
      codename: shadowState.codename,
      scores: shadowScores(shadowState, now),
      gap,
      phase: shadowPhase(shadowState, gap, now),
      rank: shadowRank(shadowState, now),
    };
  }

  const rank = profile.rank as Rank;
  // Purely presentational; free users always read STABLE, and no score or rule reads it.
  const ui = pro
    ? computeUiState({ shadowActive: shadow?.active === true, trajectory: trend, rank })
    : "STABLE";
  return {
    profile: {
      username: user.username,
      codename: profile.codename,
      publicCodename: profile.publicCodename,
      rank,
      rankSince: profile.rankSince.toISOString(),
      identitySetting: profile.identitySetting as GameState["profile"]["identitySetting"],
      primaryGoal: profile.primaryGoal,
      biggestWeakness: profile.biggestWeakness as RankedDomain,
      morningTime: profile.morningTime,
      nightlyTime: profile.nightlyTime,
      dayNumber: daysBetween(localDate(profile.onboardedAt, user.timezone), today) + 1,
      onboarded: true,
      homePathActive: profile.homePathActive,
      lifeContext: profile.lifeContext as GameState["profile"]["lifeContext"],
      season: season ? { kind: season.kind, endsOn: season.endsOn, line: season.line } : null,
    },
    scores,
    tierProgress: tierProgress(hidden, rank),
    trajectory: trend,
    uiState: ui,
    shadow,
    unseenNotices: unseen.items,
    hasMoreNotices: unseen.hasMore,
    achievements: achievementRows.map((a) => ({ id: a.achievementId, unlockedAt: a.unlockedAt.toISOString() })),
    milestones: milestoneRows.map((m) => ({
      domain: m.domain as RankedDomain,
      tier: m.tier,
      unlockedAt: m.unlockedAt.toISOString(),
    })),
    today,
  };
}
