import { and, count, eq, gt, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { comebacks, logs, profiles, quests, userDayState, users, workoutSessions } from "@workspace/db";
import {
  COMEBACK_CHECKLIST,
  HOME_LOG_TYPES,
  HOME_SESSIONS_TO_UNLOCK,
  checklistDone,
  endOfLocalDay,
  isComeback,
  localDate,
  shouldOfferHomePath,
} from "@workspace/engine";
import type { Notice } from "@workspace/contracts";
import { insertNotice } from "./scoring";
import type { Tx } from "./user-lock";

/**
 * Whether a log or gym session on `logDate` is a return after 5+ empty days. Must run BEFORE that activity is
 * applied: applyChanges moves user_day_state.lastActivityDate to `logDate`. Writes the comebacks row and the
 * `comeback` notice, never a score change.
 */
export async function detectComeback(
  tx: Tx,
  userId: string,
  opts: { logDate: string; now: Date },
): Promise<Notice[]> {
  const [day] = await tx
    .select({ last: userDayState.lastActivityDate })
    .from(userDayState)
    .where(eq(userDayState.userId, userId))
    .limit(1);
  const [row] = await tx
    .select({ onboardedAt: profiles.onboardedAt, tz: users.timezone })
    .from(profiles)
    .innerJoin(users, eq(users.id, profiles.userId))
    .where(eq(profiles.userId, userId))
    .limit(1);
  if (!day || !row) return [];
  const { comeback, gapDays } = isComeback(day.last, opts.logDate, localDate(row.onboardedAt, row.tz));
  if (!comeback) return [];

  const inserted = await tx
    .insert(comebacks)
    .values({ userId, startedOn: opts.logDate, gapDays, checklist: COMEBACK_CHECKLIST.map((c) => ({ ...c })) })
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
    { gapDays, line: "You returned. Most don't.", offerHomePath: shouldOfferHomePath(gapDays, Number(gym?.n ?? 0)) },
    opts.now,
  );
  return [notice];
}

/** Counts a home session while the home path is active; the sixth clears Tier I and opens the gym. */
export async function countHomeSession(tx: Tx, userId: string, logType: string, now: Date): Promise<Notice[]> {
  if (!(HOME_LOG_TYPES as readonly string[]).includes(logType)) return [];
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
 * Evaluates the user's comeback checklist from today's logs and quests. When the latest comeback (started
 * today) is complete: stamps it, bumps the returner count and writes the `returner_mark` notice.
 * Recognition only; no score change. Must run inside withUserLock.
 */
export async function evaluateComeback(
  tx: Tx,
  userId: string,
  now: Date,
): Promise<{ active: { gapDays: number; checklist: { key: string; label: string; done: boolean }[] } | null; returnerCount: number }> {
  const [u] = await tx.select({ tz: users.timezone }).from(users).where(eq(users.id, userId)).limit(1);
  const [profile] = await tx.select({ returnerCount: profiles.returnerCount }).from(profiles).where(eq(profiles.userId, userId)).limit(1);
  if (!u || !profile) return { active: null, returnerCount: 0 };
  const today = localDate(now, u.tz);

  const [cb] = await tx
    .select()
    .from(comebacks)
    .where(and(eq(comebacks.userId, userId), eq(comebacks.startedOn, today), isNull(comebacks.completedAt)))
    .limit(1);
  if (!cb) return { active: null, returnerCount: profile.returnerCount };

  const todayLogs = await tx
    .select({ domain: logs.domain })
    .from(logs)
    .where(and(eq(logs.userId, userId), eq(logs.localDate, today)));
  const [completed] = await tx
    .select({ n: count() })
    .from(quests)
    .where(and(eq(quests.userId, userId), eq(quests.status, "complete"), eq(quests.resolvedLocalDate, today)));
  const [pending] = await tx
    .select({ n: count() })
    .from(quests)
    .where(
      and(
        eq(quests.userId, userId),
        eq(quests.type, "daily"),
        eq(quests.status, "active"),
        gt(quests.expiresAt, now),
        lte(quests.expiresAt, endOfLocalDay(today, u.tz)),
      ),
    );
  const done = checklistDone({
    logs: todayLogs,
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
      await insertNotice(tx, userId, "returner_mark", { count: marks, line: `Returned ×${marks}.` }, now);
      return { active: null, returnerCount: marks };
    }
  }
  return {
    active: { gapDays: cb.gapDays, checklist: COMEBACK_CHECKLIST.map((c) => ({ key: c.key, label: c.label, done: done[c.key] })) },
    returnerCount: profile.returnerCount,
  };
}
