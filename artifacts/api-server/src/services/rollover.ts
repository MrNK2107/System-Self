import { and, asc, desc, eq, gte, inArray, lte, max, ne, sql } from "drizzle-orm";
import {
  achievements,
  blocks,
  clanMembers,
  dailySnapshots,
  rankFreezes,
  domainScores,
  logs,
  profiles,
  quests,
  shadowSelves,
  userDayState,
  users,
  type Db,
} from "@workspace/db";
import {
  ACHIEVEMENT_DEFS,
  QUEST_FAIL_PENALTY,
  RANKED_DOMAINS,
  addDays,
  completionMultiplier,
  daysBetween,
  decayPerDomain,
  upkeepChanges,
  endOfLocalDay,
  evaluateRankTransition,
  generateCodename,
  hiddenScore,
  initShadow,
  isShadowResolved,
  localDate,
  rankAchievement,
  shadowGap,
  shouldActivateShadow,
  streakBreaks,
  type QuestType,
  type Rank,
  type RankedDomain,
} from "@workspace/engine";
import type { Notice, NoticePayload } from "@workspace/contracts";
import { logger } from "../lib/logger";
import { resolveDueForUser } from "./challenges";
import { evaluateFinanceWeek, postRecurringIncome } from "./finance";
import { evaluatePeerRatingsWeek } from "./peer-ratings";
import { abandonChain, countsForRank } from "./quests";
import { expireAssignments, rivalRollover } from "./rivals";
import { applyChanges, insertNotice, toShadowState, type ScoreChange } from "./scoring";
import { notSystemLog } from "./system-logs";
import { withUserLock, type Tx } from "./user-lock";

/** At most this many missed dates are rolled one by one; older ones collapse into one decay step. */
export const MAX_CATCH_UP_DAYS = 30;
/** How long a claimed user is leased to one worker before another may claim it again. */
export const CLAIM_LEASE_MS = 10 * 60_000;
// Shadow activation looks at the last 7 snapshots and the 30 preceding each of them.
const SNAPSHOT_WINDOW = 37;
const DAY_MS = 86_400_000;

const round2 = (n: number) => Math.round(n * 100) / 100;

async function loadContext(tx: Tx, userId: string) {
  const [user] = await tx
    .select({ timezone: users.timezone, username: users.username })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const [profile] = await tx.select().from(profiles).where(eq(profiles.userId, userId)).limit(1);
  const [day] = await tx.select().from(userDayState).where(eq(userDayState.userId, userId)).limit(1);
  if (!user || !profile || !day) return null;
  return { user, profile, day };
}

type FreezeRange = { startedOn: string; untilOn: string };
const loadFreezes = (tx: Tx, userId: string): Promise<FreezeRange[]> =>
  tx.select({ startedOn: rankFreezes.startedOn, untilOn: rankFreezes.untilOn }).from(rankFreezes).where(eq(rankFreezes.userId, userId));
/** True when `date` is inside a Rank Freeze (start and end inclusive). A freeze never reaches back before its start. */
const frozenOn = (freezes: FreezeRange[], date: string) => freezes.some((f) => date >= f.startedOn && date <= f.untilOn);

async function currentScores(tx: Tx, userId: string): Promise<Record<RankedDomain, number>> {
  const rows = await tx.select().from(domainScores).where(eq(domainScores.userId, userId));
  const byDomain = new Map(rows.map((r) => [r.domain, r.score]));
  return Object.fromEntries(RANKED_DOMAINS.map((d) => [d, byDomain.get(d) ?? 0])) as Record<RankedDomain, number>;
}

/** Consecutive local days up to and including `date` without a single log row. */
async function inactiveDays(tx: Tx, userId: string, date: string, onboardDate: string, freezes: FreezeRange[]): Promise<number> {
  const [row] = await tx
    .select({ last: max(logs.localDate) })
    .from(logs)
    .where(and(eq(logs.userId, userId), lte(logs.localDate, date), notSystemLog));
  const lastActive = row?.last ?? addDays(onboardDate, -1);
  // Frozen days do not count: the decay ramp pauses during a Rank Freeze and resumes where it stopped.
  let frozen = 0;
  for (const f of freezes) {
    const from = f.startedOn > addDays(lastActive, 1) ? f.startedOn : addDays(lastActive, 1);
    const to = f.untilOn < date ? f.untilOn : date;
    if (from <= to) frozen += daysBetween(from, to) + 1;
  }
  return Math.max(0, daysBetween(lastActive, date) - frozen);
}

/**
 * Shame Mode (PRD 11 layer 3): a quest the owner opted in per quest failed, so every clanmate gets one `shame` notice
 * with the owner's username (clan-internal) and the quest title. The quest content is shared ONLY for these explicit
 * opt-ins. Each quest fails exactly once (the status flip above is conditional), so this runs once per quest. Only
 * notices are written for the clanmates (no lock on them is needed).
 */
async function notifyShame(tx: Tx, userId: string, username: string, titles: readonly string[], now: Date): Promise<void> {
  if (titles.length === 0) return;
  const [mine] = await tx.select({ clanId: clanMembers.clanId }).from(clanMembers).where(eq(clanMembers.userId, userId)).limit(1);
  if (!mine) return;
  // A clanmate with a block either way with the owner is told nothing.
  const mates = await tx
    .select({ userId: clanMembers.userId })
    .from(clanMembers)
    .where(
      and(
        eq(clanMembers.clanId, mine.clanId),
        ne(clanMembers.userId, userId),
        sql`not exists (select 1 from ${blocks} b where (b.blocker_id = ${clanMembers.userId} and b.blocked_id = ${userId}) or (b.blocker_id = ${userId} and b.blocked_id = ${clanMembers.userId}))`,
      ),
    )
    .orderBy(asc(clanMembers.userId));
  for (const questTitle of titles) {
    for (const m of mates) await insertNotice(tx, m.userId, "shame", { handle: username, questTitle }, now);
  }
}

function decayChanges(perDomain: number): ScoreChange[] {
  return RANKED_DOMAINS.map((domain) => ({ domain, delta: -perDomain, bonus: false, activity: false, reason: "decay" }));
}

/**
 * Applies the daily rollover for one local date (recurring income, quest expiry, streak breaks, decay, the weekly
 * finance evaluation, the weekly peer-rating close, snapshot, rank transition, shadow, rivals) and marks it rolled. A no-op returning [] if `date`
 * was already rolled.
 * Must run inside withUserLock.
 */
export async function rolloverDate(tx: Tx, userId: string, date: string, now: Date): Promise<Notice[]> {
  const ctx = await loadContext(tx, userId);
  if (!ctx) return [];
  const { user, profile, day } = ctx;
  if (day.lastRolledDate !== null && date <= day.lastRolledDate) return [];

  const tz = user.timezone;
  const opts = { localDate: date, now };
  // Effective instant of this date's rollover: the end of D, or now if D is still running. Shadow timing
  // uses it so a catch-up that activates the shadow on an older date starts it at that date's end.
  const dayEnd = endOfLocalDay(date, tz);
  const at = new Date(Math.min(now.getTime(), dayEnd.getTime()));
  const freezes = await loadFreezes(tx, userId);
  const freezeActive = frozenOn(freezes, date);
  const out: Notice[] = [];

  // 0. Recurring income due on this day of the month (system logs: no score, not activity).
  await postRecurringIncome(tx, userId, date, tz, now);

  // 1. Expire active quests that ended by the end of `date`.
  const expired = await tx
    .select()
    .from(quests)
    .where(and(eq(quests.userId, userId), eq(quests.status, "active"), lte(quests.expiresAt, dayEnd)))
    .orderBy(asc(quests.expiresAt), asc(quests.createdAt));
  const failChanges: ScoreChange[] = [];
  const failNotices: NoticePayload<"quest_failed">[] = [];
  const shamed: string[] = [];
  for (const q of expired) {
    const [failed] = await tx
      .update(quests)
      .set({ status: "failed", resolvedAt: q.expiresAt, resolvedLocalDate: date })
      .where(and(eq(quests.id, q.id), eq(quests.status, "active")))
      .returning({ id: quests.id });
    if (!failed) continue;
    if (q.chainId) await abandonChain(tx, q.chainId);
    if (q.bonus) {
      // A bonus quest has no rank effect: the result is shown (zero penalty), but no score event and no shame.
      failNotices.push({ questId: q.id, title: q.title, type: q.type as QuestType, penalty: 0, bonus: true });
      continue;
    }
    const penalty = QUEST_FAIL_PENALTY[q.type as QuestType];
    failChanges.push({ domain: "DISCIPLINE", delta: -penalty, bonus: false, activity: false, reason: "quest_failed", refId: q.id });
    failNotices.push({ questId: q.id, title: q.title, type: q.type as QuestType, penalty });
    if (q.shameMode) shamed.push(q.title);
  }
  if (failChanges.length > 0) out.push(...(await applyChanges(tx, userId, failChanges, opts)).notices);
  for (const payload of failNotices) out.push(await insertNotice(tx, userId, "quest_failed", payload, now));
  await notifyShame(tx, userId, user.username, shamed, now);

  // 2. Streak breaks.
  const rows = await tx.select().from(domainScores).where(eq(domainScores.userId, userId));
  const { broken, penalty } = streakBreaks(
    rows.map((r) => ({ domain: r.domain as RankedDomain, score: r.score, streak: r.streak, lastLogDate: r.lastLogDate })),
    date,
  );
  if (broken.length > 0) {
    const ordered = RANKED_DOMAINS.filter((d) => broken.includes(d));
    // Captured before the streaks are zeroed, for the notice.
    const lost = ordered.map((domain) => ({ domain, lostStreak: rows.find((r) => r.domain === domain)!.streak }));
    await tx
      .update(domainScores)
      .set({ streak: 0, updatedAt: now })
      .where(and(eq(domainScores.userId, userId), inArray(domainScores.domain, ordered)));
    const applied = await applyChanges(
      tx,
      userId,
      [{ domain: "DISCIPLINE", delta: -penalty, bonus: false, activity: false, reason: "streak_break" }],
      opts,
    );
    out.push(...applied.notices);
    out.push(await insertNotice(tx, userId, "streak_break", { domains: lost, penalty }, now));
  }

  // 3. Decay.
  const k = await inactiveDays(tx, userId, date, localDate(profile.onboardedAt, tz), freezes);
  const decay = decayPerDomain(k);
  if (decay > 0 && !freezeActive) out.push(...(await applyChanges(tx, userId, decayChanges(decay), opts)).notices);
  // 3a. Upkeep: every domain fades a little each day, active or not (spec 6). Paused by a Rank Freeze.
  if (!freezeActive) {
    const upkeep: ScoreChange[] = upkeepChanges().map((c) => ({ ...c, reason: "upkeep" as const }));
    out.push(...(await applyChanges(tx, userId, upkeep, opts)).notices);
  }

  // 3b. Weekly WEALTH evaluation on the last local date of the ISO week (once per week).
  out.push(...(await evaluateFinanceWeek(tx, userId, date, now)));

  // 3c. Weekly peer-rating close (SOCIAL) on the same date, once per week.
  out.push(...(await evaluatePeerRatingsWeek(tx, userId, date, now)));

  // 4. Snapshot.
  const scores = await currentScores(tx, userId);
  const resolved = await tx
    .select({ status: quests.status })
    .from(quests)
    .where(
      and(
        eq(quests.userId, userId),
        countsForRank,
        inArray(quests.status, ["complete", "failed", "refused"]),
        gte(quests.resolvedLocalDate, addDays(date, -29)),
        lte(quests.resolvedLocalDate, date),
      ),
    );
  const completed = resolved.filter((q) => q.status === "complete").length;
  const hidden = hiddenScore(scores, completionMultiplier(resolved.length, completed));
  const rank = profile.rank as Rank;
  await tx
    .insert(dailySnapshots)
    .values({ userId, localDate: date, scores, hidden, rank, createdAt: now })
    .onConflictDoUpdate({
      target: [dailySnapshots.userId, dailySnapshots.localDate],
      set: { scores, hidden, rank, createdAt: now },
    });

  // 5. Rank transition.
  const recent = await tx
    .select({ date: dailySnapshots.localDate, hidden: dailySnapshots.hidden })
    .from(dailySnapshots)
    .where(and(eq(dailySnapshots.userId, userId), lte(dailySnapshots.localDate, date)))
    .orderBy(desc(dailySnapshots.localDate))
    .limit(SNAPSHOT_WINDOW);
  const snapshots = recent.reverse();
  // Windows restart after every rank change: only snapshots dated after the rankSince local date count.
  const rankSinceDate = localDate(profile.rankSince, tz);
  const sinceRank = snapshots.filter((s) => s.date > rankSinceDate);
  // Rank Freeze pauses both windows: frozen days neither count towards a promotion or demotion run nor reset it.
  const transition = evaluateRankTransition(
    rank,
    sinceRank.filter((s) => !frozenOn(freezes, s.date)),
    freezeActive,
  );
  if (transition) {
    // The last instant of D (or now), so rankSince's local date is D and the next window starts on D+1.
    const rankSince = new Date(Math.min(now.getTime(), dayEnd.getTime() - 1));
    const newCodename = generateCodename(transition.to);
    await tx
      .update(profiles)
      .set({ rank: transition.to, rankSince, codename: newCodename })
      .where(eq(profiles.userId, userId));
    // A rank change re-matches every rival slot (PRD 14).
    await expireAssignments(tx, userId, now);
    out.push(
      await insertNotice(
        tx,
        userId,
        "rank_change",
        { from: rank, to: transition.to, kind: transition.kind, newCodename },
        now,
      ),
    );
    const achievementId = transition.kind === "promotion" ? rankAchievement(transition.to) : null;
    if (achievementId) {
      const inserted = await tx
        .insert(achievements)
        .values({ userId, achievementId, unlockedAt: now })
        .onConflictDoNothing()
        .returning();
      if (inserted.length > 0) {
        const def = ACHIEVEMENT_DEFS[achievementId];
        out.push(
          await insertNotice(
            tx,
            userId,
            "achievement",
            { id: achievementId, title: def.title, description: def.description, icon: def.icon },
            now,
          ),
        );
      }
    }
  }

  // 6. Shadow.
  const [shadowRow] = await tx.select().from(shadowSelves).where(eq(shadowSelves.userId, userId)).limit(1);
  const shadow = toShadowState(shadowRow);
  if (!shadow) {
    if (shouldActivateShadow(snapshots, k)) {
      const next = initShadow(scores, user.username, at);
      const gap = round2(shadowGap(next, scores, at));
      const values = {
        active: true,
        codename: next.codename,
        initialScores: next.initialScores,
        gainRates: next.gainRates,
        activatedAt: at,
        resolvedAt: null,
        gapAtActivation: gap,
      };
      await tx
        .insert(shadowSelves)
        .values({ userId, ...values })
        .onConflictDoUpdate({ target: shadowSelves.userId, set: values });
      out.push(await insertNotice(tx, userId, "shadow_activated", { gap, codename: next.codename }, now));
    }
  } else if (isShadowResolved(shadow, scores, at)) {
    await tx.update(shadowSelves).set({ active: false, resolvedAt: at }).where(eq(shadowSelves.userId, userId));
    out.push(await insertNotice(tx, userId, "shadow_resolved", { codename: shadow.codename }, now));
  }

  // 7. Rivals: ghost drift for `date`, rival pressure, rival challenges whose window ended.
  out.push(...(await rivalRollover(tx, userId, date, now)));

  // 8. Named challenges whose window ended by `date` (both players' locks; may defer, see services/challenges).
  out.push(...(await resolveDueForUser(tx, userId, date, now)));

  await tx.update(userDayState).set({ lastRolledDate: date }).where(eq(userDayState.userId, userId));
  return out;
}

/**
 * Passive catch-up (the worker, GET /state, ensureRolledOver, the timezone hook) rolls a local date only
 * ROLLOVER_GRACE_MS after it ends, so logs recorded offline before midnight and synced shortly after still
 * land on their own date before its streaks and decay are evaluated. Activity for a date X rolls every date
 * before X at once, ignoring the grace (see rollOverDue's `before`).
 */
export const ROLLOVER_GRACE_MS = 2 * 3600_000;

/** The instant `date` becomes rollable: the end of that local date plus the grace window. */
export function rolloverDueAt(date: string, tz: string): Date {
  return new Date(endOfLocalDay(date, tz).getTime() + ROLLOVER_GRACE_MS);
}

/**
 * Catches a user up inside the caller's locked transaction: rolls every rollable local date (see
 * ROLLOVER_GRACE_MS) from the day after `lastRolledDate` (or the onboarding day), in order, then schedules
 * the next rollover for when the first unrolled date becomes rollable. Dates older than the most recent
 * MAX_CATCH_UP_DAYS collapse into one decay-only step.
 *
 * With `before` (activity or scoring for local date `before`), exactly the dates strictly before it are
 * rolled, grace or not: the client flushes older offline logs first, so activity for X means every date
 * before X is complete. POST /logs passes its log's date (then applies the log and calls this again
 * without `before`); quest, chain, generate and gym-complete writes use rollOverBeforeToday.
 * Nothing is written when nothing is due and the schedule is unchanged.
 */
export async function rollOverDue(tx: Tx, userId: string, now: Date, opts: { before?: string } = {}): Promise<void> {
  const ctx = await loadContext(tx, userId);
  if (!ctx) {
    // A day-state row without a user/profile cannot be rolled; back off a day instead of re-leasing forever.
    const pushed = await tx
      .update(userDayState)
      .set({ nextRolloverAt: new Date(now.getTime() + DAY_MS) })
      .where(eq(userDayState.userId, userId))
      .returning({ userId: userDayState.userId });
    if (pushed.length > 0) logger.warn({ userId }, "Rollover skipped: user_day_state without a profile");
    return;
  }
  const { user, profile, day } = ctx;
  const tz = user.timezone;
  const yesterday = addDays(localDate(now, tz), -1);
  // Passive: yesterday once its grace window has passed, else the day before. Activity: the day before `before`.
  const lastDue = opts.before !== undefined ? minDate(addDays(opts.before, -1), yesterday) : passiveLastDue(now, tz);
  let start = firstUnrolledDate(day.lastRolledDate, profile.onboardedAt, tz);

  if (daysBetween(start, lastDue) + 1 > MAX_CATCH_UP_DAYS) {
    const lastCollapsed = addDays(lastDue, -MAX_CATCH_UP_DAYS);
    if (!frozenOn(await loadFreezes(tx, userId), lastCollapsed)) {
      await applyChanges(tx, userId, decayChanges(decayPerDomain(MAX_CATCH_UP_DAYS)), {
        localDate: lastCollapsed,
        now,
      });
    }
    await tx.update(userDayState).set({ lastRolledDate: lastCollapsed }).where(eq(userDayState.userId, userId));
    start = addDays(lastCollapsed, 1);
  }
  for (let d = start; d <= lastDue; d = addDays(d, 1)) await rolloverDate(tx, userId, d, now);

  const firstUnrolled = start > lastDue ? start : addDays(lastDue, 1);
  const next = rolloverDueAt(firstUnrolled, tz);
  if (next.getTime() === day.nextRolloverAt.getTime()) return;
  await tx.update(userDayState).set({ nextRolloverAt: next }).where(eq(userDayState.userId, userId));
}

const minDate = (a: string, b: string) => (a < b ? a : b);

/** The last local date a passive catch-up may roll at `now`: yesterday once its grace window has passed, else the day before. */
function passiveLastDue(now: Date, tz: string): string {
  const yesterday = addDays(localDate(now, tz), -1);
  return now.getTime() >= rolloverDueAt(yesterday, tz).getTime() ? yesterday : addDays(yesterday, -1);
}

/** The first local date not yet rolled: the day after `lastRolledDate`, or the onboarding date. */
function firstUnrolledDate(lastRolledDate: string | null, onboardedAt: Date, tz: string): string {
  return lastRolledDate !== null ? addDays(lastRolledDate, 1) : localDate(onboardedAt, tz);
}

/** For a write that counts as activity (or scores) on the user's local today: rolls every date before today. */
export async function rollOverBeforeToday(tx: Tx, userId: string, now: Date): Promise<void> {
  const [user] = await tx.select({ tz: users.timezone }).from(users).where(eq(users.id, userId)).limit(1);
  await rollOverDue(tx, userId, now, user ? { before: localDate(now, user.tz) } : {});
}

/** rollOverDue in its own per-user locked transaction (GET /state and the worker). */
export async function ensureRolledOver(db: Db, userId: string, now: Date): Promise<void> {
  await withUserLock(db, userId, (tx) => rollOverDue(tx, userId, now));
}

/**
 * GET /state's catch-up: one unlocked read decides whether a passive catch-up has anything to roll (the same test
 * rollOverDue makes), and only then takes the per-user lock. Reading without the lock is safe: a date only ever becomes
 * due with time, and a concurrent rollover can only make a stale read look due (then the locked path re-checks).
 * Unlike ensureRolledOver it does not rewrite a stale schedule when nothing is due; that is the worker's job (it claims
 * the user when the stored nextRolloverAt passes and ensureRolledOver resets it), so the worker keeps ensureRolledOver.
 */
export async function ensureRolledOverIfDue(db: Db, userId: string, now: Date): Promise<void> {
  const [row] = await db
    .select({ tz: users.timezone, lastRolledDate: userDayState.lastRolledDate, onboardedAt: profiles.onboardedAt })
    .from(userDayState)
    .innerJoin(users, eq(users.id, userDayState.userId))
    .innerJoin(profiles, eq(profiles.userId, userDayState.userId))
    .where(eq(userDayState.userId, userId))
    .limit(1);
  if (row && firstUnrolledDate(row.lastRolledDate, row.onboardedAt, row.tz) > passiveLastDue(now, row.tz)) return;
  await ensureRolledOver(db, userId, now);
}

/**
 * Claims up to `limit` users whose rollover is due, skipping rows another worker holds, and leases them
 * for CLAIM_LEASE_MS so concurrent workers never pick the same user. ensureRolledOver then sets the real
 * next rollover; a crashed worker's users become due again when the lease runs out.
 */
export async function claimDueUsers(db: Db, limit: number, now: Date = new Date()): Promise<string[]> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select({ userId: userDayState.userId })
      .from(userDayState)
      .where(lte(userDayState.nextRolloverAt, now))
      .orderBy(asc(userDayState.nextRolloverAt))
      .limit(limit)
      .for("update", { skipLocked: true });
    const ids = rows.map((r) => r.userId);
    if (ids.length > 0) {
      await tx
        .update(userDayState)
        .set({ nextRolloverAt: new Date(now.getTime() + CLAIM_LEASE_MS) })
        .where(inArray(userDayState.userId, ids));
    }
    return ids;
  });
}
