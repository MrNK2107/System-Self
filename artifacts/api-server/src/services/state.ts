import { and, asc, desc, eq, gte, inArray, isNull } from "drizzle-orm";
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
  type Rank,
  type RankedDomain,
} from "@workspace/engine";
import { NOTICE_PAGE_SIZE, type GameState, type Notice, type NoticeKind } from "@workspace/contracts";
import { toNotice, toShadowState } from "./scoring";
import { currentSeasons } from "./seasons";

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

/**
 * The user's hidden score (server-side only: callers must never put it in a response) and 7-day trajectory.
 * Shared by the game state and the social projections, so both derive from the same domain scores.
 */
export async function hiddenAndTrajectory(
  db: Pick<Db, "select">,
  userId: string,
  today: string,
  scoreMap: Record<RankedDomain, number>,
): Promise<{ hidden: number; trajectory: "up" | "stable" | "down" }> {
  const resolvedQuests = await db
    .select({ status: quests.status })
    .from(quests)
    .where(
      and(
        eq(quests.userId, userId),
        inArray(quests.status, ["complete", "failed", "refused"]),
        gte(quests.resolvedLocalDate, addDays(today, -29)),
      ),
    );
  const completed = resolvedQuests.filter((q) => q.status === "complete").length;
  const hidden = hiddenScore(scoreMap, completionMultiplier(resolvedQuests.length, completed));

  const recent = await db
    .select({ date: dailySnapshots.localDate, hidden: dailySnapshots.hidden })
    .from(dailySnapshots)
    .where(eq(dailySnapshots.userId, userId))
    .orderBy(desc(dailySnapshots.localDate))
    .limit(30);
  const snapshots = recent.reverse().map((s) => ({ date: s.date, hidden: s.hidden }));
  return { hidden, trajectory: trajectory(snapshots, hidden) };
}

/** Builds the client-facing game state. The hidden score is used internally but never included. */
export async function buildGameState(
  db: Pick<Db, "select">,
  userId: string,
  now: Date,
  opts: { noticeKinds?: readonly NoticeKind[] } = {},
): Promise<GameState | null> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const [profile] = await db.select().from(profiles).where(eq(profiles.userId, userId)).limit(1);
  if (!user || !profile) return null;

  const today = localDate(now, user.timezone);
  const rows = await db.select().from(domainScores).where(eq(domainScores.userId, userId));
  const byDomain = new Map(rows.map((r) => [r.domain, r]));
  const scores = RANKED_DOMAINS.map((d) => {
    const r = byDomain.get(d);
    return { domain: d, score: r?.score ?? 0, streak: r?.streak ?? 0, lastLogDate: r?.lastLogDate ?? null };
  });
  const scoreMap = Object.fromEntries(scores.map((s) => [s.domain, s.score])) as Record<RankedDomain, number>;

  const { hidden, trajectory: trend } = await hiddenAndTrajectory(db, userId, today, scoreMap);

  const [shadowRow] = await db.select().from(shadowSelves).where(eq(shadowSelves.userId, userId)).limit(1);
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

  const unseen = await unseenNotices(db, userId, opts.noticeKinds);
  const { active: season } = await currentSeasons(db, userId, today);

  const achievementRows = await db
    .select()
    .from(achievements)
    .where(eq(achievements.userId, userId))
    .orderBy(asc(achievements.unlockedAt), asc(achievements.achievementId));
  const milestoneRows = await db
    .select()
    .from(milestones)
    .where(eq(milestones.userId, userId))
    .orderBy(asc(milestones.unlockedAt), asc(milestones.domain), asc(milestones.tier));

  const rank = profile.rank as Rank;
  return {
    profile: {
      username: user.username,
      codename: profile.codename,
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
