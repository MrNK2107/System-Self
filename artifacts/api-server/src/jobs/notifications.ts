// Notification jobs run from the worker loop: the 18:00 quest-deadline notice and the push dispatcher. Both are cheap
// when nothing is due (an indexed query) and safe with several worker instances (a job lock plus the per-user lock).
import { and, count, eq, gt, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { endOfLocalDay, localDate, localHour } from "@workspace/engine";
import { notices, noticePushes, notificationLog, notificationPrefs, profiles, pushTokens, quests, users, type Db } from "@workspace/db";
import { env } from "../lib/env";
import { logger } from "../lib/logger";
import {
  DAILY_CAP,
  deliverableFrom,
  eventSlots,
  inDeliveryWindow,
  isPushKind,
  PUSH_MAX_AGE_MS,
  PUSH_PRIORITY,
  PUSH_TITLE,
  pushCopy,
  rankCandidates,
  WINDOW_CLOSE,
  WINDOW_EARLIEST_OPEN,
  WINDOW_LATEST_OPEN,
  type PushKind,
} from "../services/push-policy";
import { EXPO_BATCH_SIZE, PUSH_CHANNEL_ID, sendPushMessages, type PushMessage, type PushTransport } from "../services/push";
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
        await tx.insert(notices).values({ userId: c.userId, kind: "quest_deadline_24h", payload: { count: n, localDate: date }, createdAt: now });
        return 1;
      });
    } catch (err) {
      logger.error({ err, userId: c.userId }, "Quest deadline notice failed");
    }
  }
  return created;
}

/**
 * How far back undecided notices are looked at: PUSH_MAX_AGE_MS after the window opening, and the opening is at most
 * 23 h after a creation (22:00 until a 21:00 opening the next day), plus DST slack.
 */
const LOOKBACK_MS = PUSH_MAX_AGE_MS + 24 * 3600_000;
/** The app schedules its morning and nightly reminders this many days ahead (app lib/notifications-core.ts SCHEDULE_DAYS). */
export const LOCAL_SCHEDULE_DAYS = 14;

const undecided = (now: Date) =>
  and(
    isNull(noticePushes.noticeId),
    inArray(notices.kind, [...PUSH_PRIORITY]),
    gt(notices.createdAt, new Date(now.getTime() - LOOKBACK_MS)),
    lte(notices.createdAt, now),
  );

/**
 * Users with undecided push-kind notices that can be decided now: their delivery window is open, or a notice is
 * already final without one (seen in-app, or a deadline notice of an earlier local day). Users waiting for their window
 * are not returned, so they never fill the batch ahead of users whose window is open.
 */
async function pendingUsers(db: Db, now: Date, limit: number): Promise<string[]> {
  const localNow = sql`(${now.toISOString()}::timestamptz at time zone ${users.timezone})`;
  const briefing = sql`case when ${profiles.morningTime} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then ${profiles.morningTime}::time else ${WINDOW_EARLIEST_OPEN}::time end`;
  const openAt = sql`least(greatest(${WINDOW_EARLIEST_OPEN}::time, ${briefing}), ${WINDOW_LATEST_OPEN}::time)`;
  const decidable = or(
    sql`(${localNow})::time >= ${openAt} and (${localNow})::time < ${WINDOW_CLOSE}::time`,
    isNotNull(notices.seenAt),
    and(eq(notices.kind, "quest_deadline_24h"), sql`${notices.payload}->>'localDate' <> ((${localNow})::date)::text`),
  );
  const rows = await db
    .selectDistinct({ userId: notices.userId })
    .from(notices)
    .innerJoin(users, eq(users.id, notices.userId))
    .leftJoin(profiles, eq(profiles.userId, notices.userId))
    .leftJoin(noticePushes, eq(noticePushes.noticeId, notices.id))
    .where(and(undecided(now), decidable))
    .limit(limit);
  return rows.map((r) => r.userId);
}

/**
 * Decides the undecided push-kind notices of one user, in one transaction under the user lock, and returns the
 * messages to send (the caller sends them after the commit). A notice already seen in-app, a deadline notice of an
 * earlier local day, or one more than PUSH_MAX_AGE_MS past its first deliverable instant is skipped at any hour. The
 * rest are decided only inside the user's local delivery window (max(08:00, briefing) to 22:00); outside it they are
 * left for a later tick. The cap is per local day: `3 - morning - nightly` event slots (the on-device reminders reserve
 * theirs while a device was seen within the app's local schedule horizon), minus the pushes already logged that day.
 * The best candidates by priority fill the slots; the rest are dropped and stay in-app. A decision is final.
 */
async function decideUser(db: Db, userId: string, now: Date): Promise<PushMessage[]> {
  return withUserLock(db, userId, async (tx) => {
    const rows = await tx
      .select({ id: notices.id, kind: notices.kind, payload: notices.payload, createdAt: notices.createdAt, seenAt: notices.seenAt })
      .from(notices)
      .leftJoin(noticePushes, eq(noticePushes.noticeId, notices.id))
      .where(and(eq(notices.userId, userId), undecided(now)));
    if (rows.length === 0) return [];
    const [me] = await tx
      .select({ timezone: users.timezone, morningTime: profiles.morningTime })
      .from(users)
      .leftJoin(profiles, eq(profiles.userId, users.id))
      .where(eq(users.id, userId))
      .limit(1);
    if (!me) return [];
    const date = localDate(now, me.timezone);
    const open = inDeliveryWindow(now, me.timezone, me.morningTime);

    const decisions = new Map<string, "sent" | "dropped" | "skipped">();
    const eligible = rows.filter((r) => {
      // A deadline notice is about its own local day: once that day is over it is stale.
      const staleDeadline = r.kind === "quest_deadline_24h" && (r.payload as { localDate?: string }).localDate !== date;
      const expired = now.getTime() - deliverableFrom(r.createdAt, me.timezone, me.morningTime).getTime() >= PUSH_MAX_AGE_MS;
      const final = r.seenAt !== null || !isPushKind(r.kind) || staleDeadline || expired;
      if (final) decisions.set(r.id, "skipped");
      return !final && open;
    });
    const picked: typeof rows = [];
    let messages: PushMessage[] = [];
    if (open && eligible.length > 0) {
      const [prefsRow] = await tx.select().from(notificationPrefs).where(eq(notificationPrefs.userId, userId)).limit(1);
      const prefs = prefsRow ?? { morning: true, nightly: true, events: true };
      const tokens = await tx.select({ token: pushTokens.token, lastSeenAt: pushTokens.lastSeenAt }).from(pushTokens).where(eq(pushTokens.userId, userId));
      if (!prefs.events || tokens.length === 0) {
        for (const r of eligible) decisions.set(r.id, "skipped");
      } else {
        // The device schedules its reminders LOCAL_SCHEDULE_DAYS ahead whenever the app runs (and registers its token):
        // with no device seen in that horizon, no reminder fires, so none reserves a slot.
        const scheduledSince = now.getTime() - LOCAL_SCHEDULE_DAYS * 86_400_000;
        const scheduled = tokens.some((t) => t.lastSeenAt.getTime() >= scheduledSince);
        const reminders = { morning: prefs.morning && scheduled, nightly: prefs.nightly && scheduled };
        const logged = await tx
          .select({ kind: notificationLog.kind })
          .from(notificationLog)
          .where(and(eq(notificationLog.userId, userId), eq(notificationLog.localDate, date)));
        // Reserved rows only count while their reminder is off (while on, eventSlots already reserves it).
        const used = logged.filter(
          (l) => !(l.kind === RESERVED_LOG_KIND.morning && reminders.morning) && !(l.kind === RESERVED_LOG_KIND.nightly && reminders.nightly),
        ).length;
        const free = Math.max(0, Math.min(DAILY_CAP, eventSlots(reminders)) - used);
        const ranked = rankCandidates(eligible.map((r) => ({ ...r, kind: r.kind as PushKind })));
        for (const [i, r] of ranked.entries()) {
          if (i < free) picked.push(r);
          decisions.set(r.id, i < free ? "sent" : "dropped");
        }
        if (picked.length > 0) {
          await tx.insert(notificationLog).values(picked.map((r) => ({ userId, localDate: date, kind: r.kind, sentAt: now })));
        }
        messages = picked.flatMap((r) =>
          tokens.map(
            (t): PushMessage => ({
              to: t.token,
              title: PUSH_TITLE,
              body: pushCopy(r.kind as PushKind, r.payload as never),
              badge: 0,
              channelId: PUSH_CHANNEL_ID,
              data: { noticeId: r.id, kind: r.kind },
            }),
          ),
        );
      }
    }
    if (decisions.size > 0) {
      await tx.insert(noticePushes).values([...decisions].map(([noticeId, decision]) => ({ noticeId, userId, decision, decidedAt: now })));
    }
    return messages;
  });
}

type Budget = { budgetMs?: number; nowMs?: () => number };

/**
 * Decides up to `limit` users (see `decideUser`), each committed under its own user lock, and returns the messages to
 * send. Stops once `budgetMs` of wall time is spent (after at least one user); the rest waits for the next tick.
 */
export async function decidePushes(
  db: Db,
  now: Date,
  opts: Budget & { limit?: number; started?: number } = {},
): Promise<{ users: number; messages: PushMessage[] }> {
  const budgetMs = opts.budgetMs ?? env.PUSH_JOB_BUDGET_MS;
  const nowMs = opts.nowMs ?? Date.now;
  const started = opts.started ?? nowMs();
  const ids = await pendingUsers(db, now, opts.limit ?? DISPATCH_BATCH);
  const messages: PushMessage[] = [];
  let handled = 0;
  for (const [i, userId] of ids.entries()) {
    try {
      messages.push(...(await decideUser(db, userId, now)));
    } catch (err) {
      logger.error({ err, userId }, "Push decision failed");
    }
    handled++;
    if (nowMs() - started >= budgetMs && i < ids.length - 1) {
      logger.info({ handled, pending: ids.length - i - 1 }, "Push decisions stopped at their time budget");
      break;
    }
  }
  return { users: handled, messages };
}

/**
 * Sends decided messages in batches of EXPO_BATCH_SIZE, outside any transaction (each request times out on its own).
 * Delivery is at most once: a failed, timed-out or (past the budget) unsent batch loses its pushes, and the notices
 * stay in-app. Error tickets are logged as counts per Expo error code, never with tokens.
 */
export async function deliverPushes(
  db: Db,
  transport: PushTransport,
  messages: PushMessage[],
  opts: Budget & { started?: number } = {},
): Promise<{ sent: number; errors: number; unsent: number }> {
  const budgetMs = opts.budgetMs ?? env.PUSH_JOB_BUDGET_MS;
  const nowMs = opts.nowMs ?? Date.now;
  const started = opts.started ?? nowMs();
  let sent = 0;
  let errors = 0;
  let removed = 0;
  let unsent = 0;
  const errorCodes: Record<string, number> = {};
  for (let i = 0; i < messages.length; i += EXPO_BATCH_SIZE) {
    if (i > 0 && nowMs() - started >= budgetMs) {
      unsent = messages.length - i;
      break;
    }
    try {
      const r = await sendPushMessages(db, transport, messages.slice(i, i + EXPO_BATCH_SIZE));
      sent += r.sent;
      errors += r.errors;
      removed += r.removed;
      for (const [code, n] of Object.entries(r.errorCodes)) errorCodes[code] = (errorCodes[code] ?? 0) + n;
    } catch (err) {
      const n = Math.min(EXPO_BATCH_SIZE, messages.length - i);
      errors += n;
      errorCodes.send_failed = (errorCodes.send_failed ?? 0) + n;
      logger.error({ errName: err instanceof Error ? err.name : "unknown", messages: n }, "Push batch failed");
    }
  }
  if (errors > 0) logger.warn({ event: "push_error_tickets", errors, errorCodes, removed, sent }, "push_error_tickets");
  if (unsent > 0) logger.warn({ event: "push_send_budget", unsent }, "Push sending stopped at its time budget; those pushes are lost");
  return { sent, errors, unsent };
}

/**
 * Pushes new notices of the push kinds under the daily cap: decides first (committed per user), then sends. A crash
 * or a failed send never double-pushes (delivery is at most once). Device tokens Expo reports as unregistered are
 * deleted. Returns the users handled, the pushes Expo accepted and the error tickets.
 */
export async function dispatchPushes(
  db: Db,
  now: Date,
  transport: PushTransport,
  opts: Budget & { limit?: number } = {},
): Promise<{ users: number; sent: number; errors: number }> {
  const started = (opts.nowMs ?? Date.now)();
  const decided = await decidePushes(db, now, { ...opts, started });
  const out = await deliverPushes(db, transport, decided.messages, { ...opts, started });
  return { users: decided.users, sent: out.sent, errors: out.errors };
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

/**
 * One pass of the notification jobs. The dispatch job lock covers only the decisions (each committed under its user
 * lock); the messages are sent after the lock's transaction ends, so no transaction is held across HTTP. A second
 * instance cannot decide the same notices (decisions are made once, under the user lock) and so never re-sends them.
 */
export async function runNotificationJobs(db: Db, now: Date, transport: PushTransport, opts: Budget = {}) {
  const deadline = await withJobLock(db, DEADLINE_JOB_LOCK, () => createQuestDeadlineNotices(db, now));
  const started = (opts.nowMs ?? Date.now)();
  const decided = await withJobLock(db, DISPATCH_JOB_LOCK, () => decidePushes(db, now, { ...opts, started }));
  if (decided === "skipped") return { deadline, dispatch: "skipped" as const };
  const out = await deliverPushes(db, transport, decided.messages, { ...opts, started });
  return { deadline, dispatch: { users: decided.users, sent: out.sent, errors: out.errors } };
}
