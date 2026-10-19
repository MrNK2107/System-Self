import { and, count, desc, eq, gt, gte, inArray, isNotNull, isNull, lte, ne, sql } from "drizzle-orm";
import { comebacks, logs, profiles, quests, userDayState, users, workoutSessions } from "@workspace/db";
import {
  COMEBACK_CHECKLIST,
  HOME_LOG_TYPES,
  HOME_SESSIONS_TO_UNLOCK,
  addDays,
  checklistDone,
  isComeback,
  localDate,
  shouldOfferHomePath,
} from "@workspace/engine";
import type { Notice } from "@workspace/contracts";
import { insertNotice } from "./scoring";
import { notSystemLog } from "./system-logs";
import type { Tx } from "./user-lock";
import { countsForRank } from "./quests";

/**
 * Whether an activity (log, quest completion, gym session) on `activityDate` is a return after 5+ empty days. Must
 * run BEFORE that activity is applied: applyChanges moves user_day_state.lastActivityDate. The gap is judged from
 * the activity's own date, but the comeback starts today (a backdated return still gets the full window). Writes
 * the comebacks row and the `comeback` notice, never a score change.
 */
export async function detectComeback(
  tx: Tx,
  userId: string,
  opts: { activityDate: string; now: Date },
): Promise<Notice[]> {
  const [day] = await tx
    .select({ last: userDayState.lastActivityDate })
    .from(userDayState)
    .where(eq(userDayState.userId, userId))
    .limit(1);
  const [row] = await tx
    .select({ onboardedAt: profiles.onboardedAt, tz: users.timezone, homePathActive: profiles.homePathActive })
    .from(profiles)
    .innerJoin(users, eq(users.id, profiles.userId))
    .where(eq(profiles.userId, userId))
    .limit(1);
  if (!day || !row) return [];
  const { comeback, gapDays } = isComeback(day.last, opts.activityDate, localDate(row.onboardedAt, row.tz));
  if (!comeback) return [];

  const inserted = await tx
    .insert(comebacks)
    .values({ userId, startedOn: localDate(opts.now, row.tz), gapDays, checklist: COMEBACK_CHECKLIST.map((c) => ({ ...c })) })
    .onConflictDoNothing()
    .returning({ id: comebacks.id });
  if (inserted.length === 0) return [];

  const [gym] = await tx
    .select({ n: count() })
    .from(workoutSessions)
    .where(and(eq(workoutSessions.userId, userId), isNotNull(workoutSessions.completedAt)));
  const notice = await insertNotice(
    tx,
    userId,
    "comeback",
    { gapDays, line: "You returned. Most don't.", offerHomePath: !row.homePathActive && shouldOfferHomePath(gapDays, Number(gym?.n ?? 0)) },
    opts.now,
  );
  return [notice];
}

/**
 * Counts a home session while the home path is active, at most one per local day: a log counts only when no other
 * home or floor session (not forbidden) is on file for its local date. The sixth counted one clears Tier I and
 * opens the gym. Run after the log row is inserted.
 */
export async function countHomeSession(
  tx: Tx,
  userId: string,
  log: { id: string; logType: string; forbidden: boolean; localDate: string },
  now: Date,
): Promise<Notice[]> {
  if (log.forbidden || !(HOME_LOG_TYPES as readonly string[]).includes(log.logType)) return [];
  const [sameDay] = await tx
    .select({ id: logs.id })
    .from(logs)
    .where(
      and(
        eq(logs.userId, userId),
        eq(logs.localDate, log.localDate),
        eq(logs.forbidden, false),
        inArray(logs.logType, [...HOME_LOG_TYPES]),
        ne(logs.id, log.id),
      ),
    )
    .limit(1);
  if (sameDay) return [];
  const [p] = await tx
    .update(profiles)
    .set({ homeSessions: sql`${profiles.homeSessions} + 1` })
    .where(and(eq(profiles.userId, userId), eq(profiles.homePathActive, true)))
    .returning({ homeSessions: profiles.homeSessions });
  if (!p || p.homeSessions < HOME_SESSIONS_TO_UNLOCK) return [];
  await tx.update(profiles).set({ homePathActive: false }).where(eq(profiles.userId, userId));
  return [await insertNotice(tx, userId, "gym_unlocked", { line: "Tier I cleared. The gym is open to you now." }, now)];
}

/**
 * Evaluates the user's comeback checklist over its two-day window (startedOn and the next local day). When the
 * latest open comeback is complete: stamps it, bumps the returner count and writes the `returner_mark` notice.
 * Recognition only; no score change. Run inside withUserLock, at the end of every activity mutation and from GET.
 */
export async function evaluateComeback(
  tx: Tx,
  userId: string,
  now: Date,
): Promise<{
  active: { gapDays: number; checklist: { key: string; label: string; done: boolean }[] } | null;
  returnerCount: number;
  notices: Notice[];
}> {
  const [u] = await tx.select({ tz: users.timezone }).from(users).where(eq(users.id, userId)).limit(1);
  const [profile] = await tx.select({ returnerCount: profiles.returnerCount }).from(profiles).where(eq(profiles.userId, userId)).limit(1);
  if (!u || !profile) return { active: null, returnerCount: 0, notices: [] };
  const today = localDate(now, u.tz);

  const [cb] = await tx
    .select()
    .from(comebacks)
    .where(and(eq(comebacks.userId, userId), gte(comebacks.startedOn, addDays(today, -1)), isNull(comebacks.completedAt)))
    .orderBy(desc(comebacks.startedOn))
    .limit(1);
  if (!cb) return { active: null, returnerCount: profile.returnerCount, notices: [] };

  const windowLogs = await tx
    .select({ domain: logs.domain })
    .from(logs)
    .where(
      and(eq(logs.userId, userId), eq(logs.forbidden, false), gte(logs.localDate, cb.startedOn), lte(logs.localDate, today), notSystemLog),
    );
  const [completed] = await tx
    .select({ n: count() })
    .from(quests)
    .where(
      and(
        eq(quests.userId, userId),
        countsForRank,
        eq(quests.status, "complete"),
        gte(quests.resolvedLocalDate, cb.startedOn),
        lte(quests.resolvedLocalDate, today),
      ),
    );
  // Only unresolved, unexpired dailies block: refused and failed ones are done with.
  const [pending] = await tx
    .select({ n: count() })
    .from(quests)
    .where(and(eq(quests.userId, userId), countsForRank, eq(quests.type, "daily"), eq(quests.status, "active"), gt(quests.expiresAt, now)));
  const done = checklistDone({
    logs: windowLogs,
    questsCompletedToday: Number(completed?.n ?? 0),
    dailiesPending: Number(pending?.n ?? 0),
  });

  if (COMEBACK_CHECKLIST.every((c) => done[c.key])) {
    const [stamped] = await tx
      .update(comebacks)
      .set({ completedAt: now })
      .where(and(eq(comebacks.id, cb.id), isNull(comebacks.completedAt)))
      .returning({ id: comebacks.id });
    if (stamped) {
      const [bumped] = await tx
        .update(profiles)
        .set({ returnerCount: sql`${profiles.returnerCount} + 1` })
        .where(eq(profiles.userId, userId))
        .returning({ returnerCount: profiles.returnerCount });
      const marks = bumped!.returnerCount;
      const notice = await insertNotice(tx, userId, "returner_mark", { count: marks, line: `Returned ×${marks}.` }, now);
      return { active: null, returnerCount: marks, notices: [notice] };
    }
  }
  return {
    active: { gapDays: cb.gapDays, checklist: COMEBACK_CHECKLIST.map((c) => ({ key: c.key, label: c.label, done: done[c.key] })) },
    returnerCount: profile.returnerCount,
    notices: [],
  };
}
