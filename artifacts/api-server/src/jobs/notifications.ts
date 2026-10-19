// Notification jobs run from the worker loop: the 18:00 quest-deadline notice and the push dispatcher. Both are cheap
// when nothing is due (an indexed query) and safe with several worker instances (a job lock plus the per-user lock).
import { and, count, eq, gt, inArray, isNull, lte, sql } from "drizzle-orm";
import { endOfLocalDay, localDate, localHour } from "@workspace/engine";
import { notices, noticePushes, notificationLog, notificationPrefs, pushTokens, quests, users, type Db } from "@workspace/db";
import { logger } from "../lib/logger";
import {
  DAILY_CAP,
  eventSlots,
  isPushKind,
  PUSH_MAX_AGE_MS,
  PUSH_PRIORITY,
  PUSH_TITLE,
  pushCopy,
  rankCandidates,
  type PushKind,
} from "../services/push-policy";
import { sendPushMessages, type PushMessage, type PushTransport } from "../services/push";
import { withUserLock } from "../services/user-lock";
import { JOB_LOCK_NAMESPACE, withJobLock } from "./social";

export const DEADLINE_JOB_LOCK = { namespace: JOB_LOCK_NAMESPACE, key: "notify:quest-deadline" } as const;
export const DISPATCH_JOB_LOCK = { namespace: JOB_LOCK_NAMESPACE, key: "notify:dispatch" } as const;
/** The deadline notice is written from this local hour onward. */
export const DEADLINE_LOCAL_HOUR = 18;
/** ...and not from this local hour on (a notice written at 23:59 would push on the next day). */
export const DEADLINE_LAST_LOCAL_HOUR = 23;
/** Reserved log rows (a reminder switched off after it fired) use these kinds. */
export const RESERVED_LOG_KIND = { morning: "reminder_morning", nightly: "reminder_nightly" } as const;
/** Users handled per dispatch pass; the rest wait for the next tick. */
export const DISPATCH_BATCH = 200;

/**
 * At local 18:00 or later, writes one `quest_deadline_24h` notice per user per local day when at least one active,
 * non-bonus quest expires before local midnight. Bonus quests never count. Returns the notices written.
 */
export async function createQuestDeadlineNotices(db: Db, now: Date): Promise<number> {
  // The end of any local day is at most 24 h away (plus DST slack), so a 30 h window finds every candidate.
  const candidates = await db
    .selectDistinct({ userId: quests.userId, timezone: users.timezone })
    .from(quests)
    .innerJoin(users, eq(users.id, quests.userId))
    .where(
      and(
        eq(quests.status, "active"),
        eq(quests.bonus, false),
        gt(quests.expiresAt, now),
        lte(quests.expiresAt, new Date(now.getTime() + 30 * 3600_000)),
      ),
    );
  let created = 0;
  for (const c of candidates) {
    const hour = localHour(now, c.timezone);
    if (hour < DEADLINE_LOCAL_HOUR || hour >= DEADLINE_LAST_LOCAL_HOUR) continue;
    const date = localDate(now, c.timezone);
    const end = endOfLocalDay(date, c.timezone);
    try {
      created += await withUserLock(db, c.userId, async (tx) => {
        const [dup] = await tx
          .select({ id: notices.id })
          .from(notices)
          .where(
            and(eq(notices.userId, c.userId), eq(notices.kind, "quest_deadline_24h"), sql`${notices.payload}->>'localDate' = ${date}`),
          )
          .limit(1);
        if (dup) return 0;
        const [row] = await tx
          .select({ n: count() })
          .from(quests)
          .where(
            and(
              eq(quests.userId, c.userId),
              eq(quests.status, "active"),
              eq(quests.bonus, false),
              gt(quests.expiresAt, now),
              lte(quests.expiresAt, end),
            ),
          );
        const n = row?.n ?? 0;
        if (n === 0) return 0;
        await tx.insert(notices).values({ userId: c.userId, kind: "quest_deadline_24h", payload: { count: n, localDate: date } });
        return 1;
      });
    } catch (err) {
      logger.error({ err, userId: c.userId }, "Quest deadline notice failed");
    }
  }
  return created;
}

const undecided = (now: Date) =>
  and(
    isNull(noticePushes.noticeId),
    inArray(notices.kind, [...PUSH_PRIORITY]),
    gt(notices.createdAt, new Date(now.getTime() - PUSH_MAX_AGE_MS)),
    lte(notices.createdAt, now),
  );

async function pendingUsers(db: Db, now: Date, limit: number): Promise<string[]> {
  const rows = await db
    .selectDistinct({ userId: notices.userId })
    .from(notices)
    .leftJoin(noticePushes, eq(noticePushes.noticeId, notices.id))
    .where(undecided(now))
    .limit(limit);
  return rows.map((r) => r.userId);
}

/**
 * Decides every undecided push-kind notice of one user, in one transaction under the user lock, and returns the
 * messages to send. The cap is per local day: `3 - morning - nightly` event slots (the on-device reminders reserve
 * theirs), minus the pushes already logged that day. The best candidates by priority fill the slots; the rest are
 * dropped and stay in-app. A decision is final, so a filled slot stays filled.
 */
async function decideUser(db: Db, userId: string, now: Date): Promise<PushMessage[]> {
  return withUserLock(db, userId, async (tx) => {
    const rows = await tx
      .select({ id: notices.id, kind: notices.kind, payload: notices.payload, createdAt: notices.createdAt, seenAt: notices.seenAt })
      .from(notices)
      .leftJoin(noticePushes, eq(noticePushes.noticeId, notices.id))
      .where(and(eq(notices.userId, userId), undecided(now)));
    if (rows.length === 0) return [];
    const [me] = await tx.select({ timezone: users.timezone }).from(users).where(eq(users.id, userId)).limit(1);
    if (!me) return [];
    const [prefsRow] = await tx.select().from(notificationPrefs).where(eq(notificationPrefs.userId, userId)).limit(1);
    const prefs = prefsRow ?? { morning: true, nightly: true, events: true };
    const tokens = await tx.select({ token: pushTokens.token }).from(pushTokens).where(eq(pushTokens.userId, userId));
    const date = localDate(now, me.timezone);

    const decisions = new Map<string, "sent" | "dropped" | "skipped">();
    const eligible = rows.filter((r) => {
      // A deadline notice is about its own local day: once that day is over it is stale.
      const stale = r.kind === "quest_deadline_24h" && (r.payload as { localDate?: string }).localDate !== date;
      const ok = r.seenAt === null && isPushKind(r.kind) && !stale;
      if (!ok) decisions.set(r.id, "skipped");
      return ok;
    });
    const picked: typeof rows = [];
    if (!prefs.events || tokens.length === 0) {
      for (const r of eligible) decisions.set(r.id, "skipped");
    } else {
      const logged = await tx
        .select({ kind: notificationLog.kind })
        .from(notificationLog)
        .where(and(eq(notificationLog.userId, userId), eq(notificationLog.localDate, date)));
      // Reserved rows only count while their reminder is off (while on, eventSlots already reserves it).
      const used = logged.filter(
        (l) => !(l.kind === RESERVED_LOG_KIND.morning && prefs.morning) && !(l.kind === RESERVED_LOG_KIND.nightly && prefs.nightly),
      ).length;
      const free = Math.max(0, Math.min(DAILY_CAP, eventSlots(prefs)) - used);
      const ranked = rankCandidates(eligible.map((r) => ({ ...r, kind: r.kind as PushKind })));
      for (const [i, r] of ranked.entries()) {
        if (i < free) picked.push(r);
        decisions.set(r.id, i < free ? "sent" : "dropped");
      }
    }
    await tx.insert(noticePushes).values([...decisions].map(([noticeId, decision]) => ({ noticeId, userId, decision, decidedAt: now })));
    if (picked.length === 0) return [];
    await tx.insert(notificationLog).values(picked.map((r) => ({ userId, localDate: date, kind: r.kind, sentAt: now })));
    return picked.flatMap((r) =>
      tokens.map(
        (t): PushMessage => ({
          to: t.token,
          title: PUSH_TITLE,
          body: pushCopy(r.kind as PushKind, r.payload as never),
          badge: 0,
          sound: "default",
          data: { noticeId: r.id, kind: r.kind },
        }),
      ),
    );
  });
}

/**
 * Pushes new notices of the push kinds under the daily cap (see `decideUser`). Decisions are committed before the
 * send, so a crash or a failed send never double-pushes (delivery is at most once). Device tokens Expo reports as
 * unregistered are deleted. Returns the users handled and the pushes Expo accepted.
 */
export async function dispatchPushes(
  db: Db,
  now: Date,
  transport: PushTransport,
  limit = DISPATCH_BATCH,
): Promise<{ users: number; sent: number }> {
  const ids = await pendingUsers(db, now, limit);
  let sent = 0;
  for (const userId of ids) {
    try {
      const messages = await decideUser(db, userId, now);
      sent += (await sendPushMessages(db, transport, messages)).sent;
    } catch (err) {
      logger.error({ err, userId }, "Push dispatch failed");
    }
  }
  return { users: ids.length, sent };
}

/** Push decisions and the push log only matter for the day cap; kept this long for support. */
export const PUSH_LOG_TTL_MS = 30 * 86_400_000;
export const PRUNE_BATCH = 1000;
export const PRUNE_MAX_BATCHES = 5;

/**
 * Deletes `notification_log` and `notice_pushes` rows older than 30 days in bounded batches (indexed by their
 * timestamps), at most `maxBatches` per table per call; the rest waits for the next tick. Returns the rows deleted.
 */
export async function prunePushLogs(
  db: Db,
  now: Date,
  opts: { batch?: number; maxBatches?: number } = {},
): Promise<number> {
  const batch = opts.batch ?? PRUNE_BATCH;
  const maxBatches = opts.maxBatches ?? PRUNE_MAX_BATCHES;
  const cutoff = new Date(now.getTime() - PUSH_LOG_TTL_MS);
  let total = 0;
  for (let i = 0; i < maxBatches; i++) {
    const res = await db.execute(
      sql`delete from notification_log where id in (select id from notification_log where sent_at < ${cutoff} limit ${batch})`,
    );
    total += res.rowCount ?? 0;
    if ((res.rowCount ?? 0) < batch) break;
  }
  for (let i = 0; i < maxBatches; i++) {
    const res = await db.execute(
      sql`delete from notice_pushes where notice_id in (select notice_id from notice_pushes where decided_at < ${cutoff} limit ${batch})`,
    );
    total += res.rowCount ?? 0;
    if ((res.rowCount ?? 0) < batch) break;
  }
  return total;
}

/** One pass of the notification jobs. */
export async function runNotificationJobs(db: Db, now: Date, transport: PushTransport) {
  const deadline = await withJobLock(db, DEADLINE_JOB_LOCK, () => createQuestDeadlineNotices(db, now));
  const dispatch = await withJobLock(db, DISPATCH_JOB_LOCK, () => dispatchPushes(db, now, transport));
  return { deadline, dispatch };
}
