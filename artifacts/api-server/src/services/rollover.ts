import { and, asc, desc, eq, gte, inArray, lte, max } from "drizzle-orm";
import {
  achievements,
  dailySnapshots,
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
import type { Notice } from "@workspace/contracts";
import { logger } from "../lib/logger";
import { abandonChain } from "./quests";
import { applyChanges, insertNotice, toShadowState, type ScoreChange } from "./scoring";
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

const freezeActiveOn = (date: string, rankFreezeUntil: string | null) =>
  rankFreezeUntil !== null && date <= rankFreezeUntil;

async function currentScores(tx: Tx, userId: string): Promise<Record<RankedDomain, number>> {
  const rows = await tx.select().from(domainScores).where(eq(domainScores.userId, userId));
  const byDomain = new Map(rows.map((r) => [r.domain, r.score]));
  return Object.fromEntries(RANKED_DOMAINS.map((d) => [d, byDomain.get(d) ?? 0])) as Record<RankedDomain, number>;
}

/** Consecutive local days up to and including `date` without a single log row. */
async function inactiveDays(tx: Tx, userId: string, date: string, onboardDate: string): Promise<number> {
  const [row] = await tx
    .select({ last: max(logs.localDate) })
    .from(logs)
    .where(and(eq(logs.userId, userId), lte(logs.localDate, date)));
  const lastActive = row?.last ?? addDays(onboardDate, -1);
  return Math.max(0, daysBetween(lastActive, date));
}

function decayChanges(perDomain: number): ScoreChange[] {
  return RANKED_DOMAINS.map((domain) => ({ domain, delta: -perDomain, bonus: false, activity: false, reason: "decay" }));
}

/**
 * Applies the daily rollover for one local date (quest expiry, streak breaks, decay, snapshot, rank
 * transition, shadow) and marks it rolled. A no-op returning [] if `date` was already rolled.
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
  const freezeActive = freezeActiveOn(date, profile.rankFreezeUntil);
  const out: Notice[] = [];

  // 1. Expire active quests that ended by the end of `date`.
  const expired = await tx
    .select()
    .from(quests)
    .where(and(eq(quests.userId, userId), eq(quests.status, "active"), lte(quests.expiresAt, dayEnd)))
    .orderBy(asc(quests.expiresAt), asc(quests.createdAt));
  const failChanges: ScoreChange[] = [];
  const failNotices: { questId: string; title: string; type: string; penalty: number }[] = [];
  for (const q of expired) {
    const [failed] = await tx
      .update(quests)
      .set({ status: "failed", resolvedAt: q.expiresAt, resolvedLocalDate: date })
      .where(and(eq(quests.id, q.id), eq(quests.status, "active")))
      .returning({ id: quests.id });
    if (!failed) continue;
    if (q.chainId) await abandonChain(tx, q.chainId);
    const penalty = QUEST_FAIL_PENALTY[q.type as QuestType];
    failChanges.push({ domain: "DISCIPLINE", delta: -penalty, bonus: false, activity: false, reason: "quest_failed", refId: q.id });
    failNotices.push({ questId: q.id, title: q.title, type: q.type, penalty });
  }
  if (failChanges.length > 0) out.push(...(await applyChanges(tx, userId, failChanges, opts)).notices);
  for (const payload of failNotices) out.push(await insertNotice(tx, userId, "quest_failed", payload, now));

  // 2. Streak breaks.
  const rows = await tx.select().from(domainScores).where(eq(domainScores.userId, userId));
  const { broken, penalty } = streakBreaks(
    rows.map((r) => ({ domain: r.domain as RankedDomain, score: r.score, streak: r.streak, lastLogDate: r.lastLogDate })),
    date,
  );
  if (broken.length > 0) {
    const ordered = RANKED_DOMAINS.filter((d) => broken.includes(d));
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
    out.push(await insertNotice(tx, userId, "streak_break", { domains: ordered, penalty }, now));
  }

  // 3. Decay.
  const k = await inactiveDays(tx, userId, date, localDate(profile.onboardedAt, tz));
  const decay = decayPerDomain(k);
  if (decay > 0 && !freezeActive) out.push(...(await applyChanges(tx, userId, decayChanges(decay), opts)).notices);

  // 4. Snapshot.
  const scores = await currentScores(tx, userId);
  const resolved = await tx
    .select({ status: quests.status })
    .from(quests)
    .where(
      and(
        eq(quests.userId, userId),
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
  const transition = evaluateRankTransition(
    rank,
    snapshots.filter((s) => s.date > rankSinceDate),
    freezeActive,
  );
  if (transition) {
    // The last instant of D (or now), so rankSince's local date is D and the next window starts on D+1.
    const rankSince = new Date(Math.min(now.getTime(), dayEnd.getTime() - 1));
    await tx
      .update(profiles)
      .set({ rank: transition.to, rankSince, codename: generateCodename(transition.to) })
      .where(eq(profiles.userId, userId));
    out.push(
      await insertNotice(tx, userId, "rank_change", { from: rank, to: transition.to, kind: transition.kind }, now),
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
      out.push(await insertNotice(tx, userId, "shadow_activated", { gap }, now));
    }
  } else if (isShadowResolved(shadow, scores, at)) {
    await tx.update(shadowSelves).set({ active: false, resolvedAt: at }).where(eq(shadowSelves.userId, userId));
    out.push(await insertNotice(tx, userId, "shadow_resolved", { codename: shadow.codename }, now));
  }

  await tx.update(userDayState).set({ lastRolledDate: date }).where(eq(userDayState.userId, userId));
  return out;
}

/**
 * Catches a user up inside the caller's locked transaction: rolls every local date from the day after
 * `lastRolledDate` (or the onboarding day) through yesterday, in order, then schedules the next rollover
 * at the end of today. Dates older than the most recent MAX_CATCH_UP_DAYS collapse into one decay-only
 * step. Mutating game routes call this first so a new write never lands before older dates are rolled
 * (POST /logs, quest complete/refuse, POST /chains; POST /quests/generate must too when it lands in Task 8).
 */
export async function rollOverDue(tx: Tx, userId: string, now: Date): Promise<void> {
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
  const today = localDate(now, tz);
  const yesterday = addDays(today, -1);
  let start = day.lastRolledDate !== null ? addDays(day.lastRolledDate, 1) : localDate(profile.onboardedAt, tz);

  if (daysBetween(start, yesterday) + 1 > MAX_CATCH_UP_DAYS) {
    const lastCollapsed = addDays(yesterday, -MAX_CATCH_UP_DAYS);
    if (!freezeActiveOn(lastCollapsed, profile.rankFreezeUntil)) {
      await applyChanges(tx, userId, decayChanges(decayPerDomain(MAX_CATCH_UP_DAYS)), {
        localDate: lastCollapsed,
        now,
      });
    }
    await tx.update(userDayState).set({ lastRolledDate: lastCollapsed }).where(eq(userDayState.userId, userId));
    start = addDays(lastCollapsed, 1);
  }
  for (let d = start; d <= yesterday; d = addDays(d, 1)) await rolloverDate(tx, userId, d, now);

  await tx
    .update(userDayState)
    .set({ nextRolloverAt: endOfLocalDay(today, tz) })
    .where(eq(userDayState.userId, userId));
}

/** rollOverDue in its own per-user locked transaction (GET /state and the worker). */
export async function ensureRolledOver(db: Db, userId: string, now: Date): Promise<void> {
  await withUserLock(db, userId, (tx) => rollOverDue(tx, userId, now));
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
