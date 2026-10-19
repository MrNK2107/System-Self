import { and, eq, gte, lte, ne, sql } from "drizzle-orm";
import { achievements, logs, questChains, quests, scoreEvents, type Db } from "@workspace/db";
import { RANKED_DOMAINS, addDays, endOfLocalDay, type RankedDomain } from "@workspace/engine";
import { notSystemLog } from "./system-logs";
import { countsForRank } from "./quests";

export interface WeeklyRecap {
  weekStart: string;
  domainDeltas: Record<RankedDomain, number>;
  questsCompleted: number;
  questsFailed: number;
  questsRefused: number;
  logsCount: number;
  forbiddenLogs: number;
  peakDomain: RankedDomain | null;
  chainsCompleted: number;
  achievementsUnlocked: number;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Everything the weekly recap reports, scoped to the last 7 local days (today and the 6 before it). */
export async function buildWeeklyRecap(
  db: Pick<Db, "select">,
  userId: string,
  today: string,
  tz: string,
): Promise<WeeklyRecap> {
  const weekStart = addDays(today, -6);
  const startInstant = endOfLocalDay(addDays(weekStart, -1), tz);

  const deltaRows = await db
    .select({ domain: scoreEvents.domain, total: sql<number>`coalesce(sum(${scoreEvents.actualDelta}), 0)::float8` })
    .from(scoreEvents)
    .where(
      and(
        eq(scoreEvents.userId, userId),
        gte(scoreEvents.localDate, weekStart),
        lte(scoreEvents.localDate, today),
        ne(scoreEvents.reason, "onboarding"), // the starting ratings are not a week's movement
      ),
    )
    .groupBy(scoreEvents.domain);
  const domainDeltas = Object.fromEntries(
    RANKED_DOMAINS.map((d) => [d, round1(deltaRows.find((r) => r.domain === d)?.total ?? 0)]),
  ) as Record<RankedDomain, number>;
  let peakDomain: RankedDomain | null = null;
  for (const d of RANKED_DOMAINS) {
    if (domainDeltas[d] > 0 && (peakDomain === null || domainDeltas[d] > domainDeltas[peakDomain])) peakDomain = d;
  }

  const questRows = await db
    .select({ status: quests.status, n: sql<number>`count(*)::int` })
    .from(quests)
    .where(and(eq(quests.userId, userId), countsForRank, gte(quests.resolvedLocalDate, weekStart), lte(quests.resolvedLocalDate, today)))
    .groupBy(quests.status);
  const questCount = (status: string) => questRows.find((r) => r.status === status)?.n ?? 0;

  const [logRow] = await db
    .select({
      total: sql<number>`count(*)::int`,
      forbidden: sql<number>`count(*) filter (where ${logs.forbidden})::int`,
    })
    .from(logs)
    .where(and(eq(logs.userId, userId), gte(logs.localDate, weekStart), lte(logs.localDate, today), notSystemLog));

  const [chainRow] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(questChains)
    .where(and(eq(questChains.userId, userId), eq(questChains.status, "complete"), gte(questChains.completedAt, startInstant)));
  const [achRow] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(achievements)
    .where(and(eq(achievements.userId, userId), gte(achievements.unlockedAt, startInstant)));

  return {
    weekStart,
    domainDeltas,
    questsCompleted: questCount("complete"),
    questsFailed: questCount("failed"),
    questsRefused: questCount("refused"),
    logsCount: logRow?.total ?? 0,
    forbiddenLogs: logRow?.forbidden ?? 0,
    peakDomain,
    chainsCompleted: chainRow?.n ?? 0,
    achievementsUnlocked: achRow?.n ?? 0,
  };
}
