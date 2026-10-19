import { and, count, countDistinct, eq, gte, isNotNull, lte, sql } from "drizzle-orm";
import { analyticsEvents, comebacks, logs, quests, type Db } from "@workspace/db";
import { COMEBACK_MIN_GAP_DAYS, addDays, localDate } from "@workspace/engine";
import type { AdherenceMetricsResponse } from "@workspace/contracts";
import { notSystemLog } from "./system-logs";

/** BODY log types that are a training session. */
export const SESSION_LOG_TYPES = ["gym_session", "home_session", "floor_session"] as const;
/** A follow-up BODY log within this many days of a return session makes it a second visit. */
export const SECOND_VISIT_DAYS = 7;

const ratio = (n: number, d: number) => (d === 0 ? 0 : n / d);

/**
 * Metric definitions (counts and ratios only, never a score; every ratio is 0 when its denominator is 0).
 * Window: the last `days` days up to `now`; date columns use the UTC date of `now`.
 * - floorUptake = floor_completed / floor_offered analytics events in the window.
 * - secondVisitRate: a return session is a BODY gym/home/floor session whose previous such session was at least
 *   COMEBACK_MIN_GAP_DAYS empty local days earlier (a first-ever session is not a return). It has a second visit
 *   when any BODY log lands 1-7 days after it. Users with a second visit / users with a return. Right-censored:
 *   only returns at least 7 days old count, so a follow-up window is never cut short.
 * - comebackRate = comebacks with completedAt / comebacks, both started in the window and at least 7 days old.
 * - deferralsPerActiveUser = refusals with a reason by active users / active users, where an active user logged
 *   anything in the window.
 */
export async function adherenceMetrics(db: Db, now: Date, days: number): Promise<AdherenceMetricsResponse> {
  const since = new Date(now.getTime() - days * 86_400_000);
  const today = localDate(now, "UTC");
  const windowStart = localDate(since, "UTC");
  const cutoff = addDays(today, -SECOND_VISIT_DAYS);
  const minGap = COMEBACK_MIN_GAP_DAYS + 1; // 5 empty days between = dates 6 apart
  const types = sql.join(SESSION_LOG_TYPES.map((t) => sql`${t}`), sql`, `);

  const eventCount = async (name: string) => {
    const [r] = await db
      .select({ n: count() })
      .from(analyticsEvents)
      .where(and(eq(analyticsEvents.name, name), gte(analyticsEvents.createdAt, since)));
    return r?.n ?? 0;
  };
  const floorOffered = await eventCount("floor_offered");
  const floorCompleted = await eventCount("floor_completed");

  // Only the window's session days are scanned; the previous session and the follow-up are index lookups.
  const sv = await db.execute<{ returned: number; second: number }>(sql`
    select count(distinct r.user_id)::int as returned,
           (count(distinct r.user_id) filter (where r.followed))::int as second
    from (
      select s.user_id,
             exists (
               select 1 from logs l
               where l.user_id = s.user_id and l.domain = 'BODY'
                 and l.local_date > s.local_date and l.local_date <= s.local_date + ${SECOND_VISIT_DAYS}::int
             ) as followed
      from (
        select distinct user_id, local_date from logs
        where domain = 'BODY' and log_type in (${types})
          and local_date >= ${windowStart}::date and local_date <= ${cutoff}::date
      ) s
      cross join lateral (
        select max(p.local_date) as pd from logs p
        where p.user_id = s.user_id and p.domain = 'BODY' and p.log_type in (${types}) and p.local_date < s.local_date
      ) prev
      where prev.pd is not null and s.local_date - prev.pd >= ${minGap}::int
    ) r
  `);
  const svRow = sv.rows[0] ?? { returned: 0, second: 0 };

  const [cb] = await db
    .select({ total: count(), done: sql<number>`count(${comebacks.completedAt})::int` })
    .from(comebacks)
    .where(and(gte(comebacks.startedOn, windowStart), lte(comebacks.startedOn, cutoff)));

  const activeUsers = sql`select user_id from ${logs} where local_date >= ${windowStart}::date and ${notSystemLog}`;
  const [active] = await db.select({ n: countDistinct(logs.userId) }).from(logs).where(and(gte(logs.localDate, windowStart), notSystemLog));
  const [deferrals] = await db
    .select({ n: count() })
    .from(quests)
    .where(
      and(
        eq(quests.status, "refused"),
        isNotNull(quests.refusalReason),
        sql`btrim(${quests.refusalReason}) <> ''`,
        gte(quests.resolvedLocalDate, windowStart),
        sql`${quests.userId} in (${activeUsers})`,
      ),
    );

  return {
    floorOffered,
    floorCompleted,
    floorUptake: ratio(floorCompleted, floorOffered),
    secondVisitRate: ratio(svRow.second, svRow.returned),
    comebackRate: ratio(cb?.done ?? 0, cb?.total ?? 0),
    deferralsPerActiveUser: ratio(deferrals?.n ?? 0, active?.n ?? 0),
  };
}
