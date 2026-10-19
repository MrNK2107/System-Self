import { and, count, countDistinct, eq, gte, isNotNull, sql } from "drizzle-orm";
import { analyticsEvents, comebacks, logs, quests, type Db } from "@workspace/db";
import { COMEBACK_MIN_GAP_DAYS, addDays, daysBetween, localDate } from "@workspace/engine";
import type { AdherenceMetricsResponse } from "@workspace/contracts";

/** BODY log types that are a training session. */
export const SESSION_LOG_TYPES = ["gym_session", "home_session", "floor_session"];
/** A follow-up BODY log within this many days of a return session makes it a second visit. */
export const SECOND_VISIT_DAYS = 7;

const ratio = (n: number, d: number) => (d === 0 ? 0 : n / d);

export interface BodyLogRow {
  userId: string;
  localDate: string;
  logType: string;
}

/**
 * Users with a "return session" in the window, and how many of them trained again.
 * A return session is a BODY session (gym, home or floor) that follows the user's previous BODY session by at
 * least COMEBACK_MIN_GAP_DAYS empty local days. It has a second visit when another BODY log (any type) lands
 * on a later local date within SECOND_VISIT_DAYS days. A user's first session ever is not a return.
 */
export function secondVisitStats(rows: BodyLogRow[], windowStart: string): { returned: number; second: number } {
  const byUser = new Map<string, BodyLogRow[]>();
  for (const r of rows) byUser.set(r.userId, [...(byUser.get(r.userId) ?? []), r]);
  let returned = 0;
  let second = 0;
  for (const userRows of byUser.values()) {
    const sessions = userRows.filter((r) => SESSION_LOG_TYPES.includes(r.logType)).map((r) => r.localDate).sort();
    const days = [...new Set(sessions)];
    const returns = days.filter((d, i) => i > 0 && d >= windowStart && daysBetween(days[i - 1]!, d) - 1 >= COMEBACK_MIN_GAP_DAYS);
    if (returns.length === 0) continue;
    returned += 1;
    const bodyDays = userRows.map((r) => r.localDate);
    if (returns.some((d) => bodyDays.some((b) => b > d && b <= addDays(d, SECOND_VISIT_DAYS)))) second += 1;
  }
  return { returned, second };
}

/** The adherence metrics over the last `days` days up to `now`. Counts and ratios only; never a score. */
export async function adherenceMetrics(db: Db, now: Date, days: number): Promise<AdherenceMetricsResponse> {
  const since = new Date(now.getTime() - days * 86_400_000);
  const windowStart = localDate(since, "UTC");

  const eventCount = async (name: string) => {
    const [r] = await db
      .select({ n: count() })
      .from(analyticsEvents)
      .where(and(eq(analyticsEvents.name, name), gte(analyticsEvents.createdAt, since)));
    return r?.n ?? 0;
  };
  const floorOffered = await eventCount("floor_offered");
  const floorCompleted = await eventCount("floor_completed");

  const bodyRows = await db
    .select({ userId: logs.userId, localDate: logs.localDate, logType: logs.logType })
    .from(logs)
    .where(eq(logs.domain, "BODY"));
  const sv = secondVisitStats(bodyRows, windowStart);

  const [cb] = await db
    .select({ total: count(), done: sql<number>`count(${comebacks.completedAt})::int` })
    .from(comebacks)
    .where(gte(comebacks.startedOn, windowStart));

  const [active] = await db.select({ n: countDistinct(logs.userId) }).from(logs).where(gte(logs.localDate, windowStart));
  const [deferrals] = await db
    .select({ n: count() })
    .from(quests)
    .where(
      and(
        eq(quests.status, "refused"),
        isNotNull(quests.refusalReason),
        sql`btrim(${quests.refusalReason}) <> ''`,
        gte(quests.resolvedLocalDate, windowStart),
      ),
    );

  return {
    floorOffered,
    floorCompleted,
    floorUptake: ratio(floorCompleted, floorOffered),
    secondVisitRate: ratio(sv.second, sv.returned),
    comebackRate: ratio(cb?.done ?? 0, cb?.total ?? 0),
    deferralsPerActiveUser: ratio(deferrals?.n ?? 0, active?.n ?? 0),
  };
}
