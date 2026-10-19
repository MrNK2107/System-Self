// Social jobs run from the worker loop. Each job holds a transaction-scoped advisory lock (its own key in the
// job namespace) while it runs, so with several worker instances one instance runs each job at a time.
import { asc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { clans, jobRuns, type Db } from "@workspace/db";
import { env } from "../lib/env";
import { logger } from "../lib/logger";
import { assignClanRanks, computeClanScores, repairClans, updateDeadWeightFlags } from "../services/clans";
import { ensureAssignments, usersWithExpiredSlots } from "../services/rivals";
import { withUserLock } from "../services/user-lock";

/** Two-key advisory locks (namespace, hashtext(key)) never collide with the per-user one-key locks. */
export const JOB_LOCK_NAMESPACE = 5501;
export const RIVAL_JOB_LOCK = { namespace: JOB_LOCK_NAMESPACE, key: "social:rival-refresh" } as const;
export const CLAN_SCORE_JOB_LOCK = { namespace: JOB_LOCK_NAMESPACE, key: "social:clan-scores" } as const;
export const DEAD_WEIGHT_JOB_LOCK = { namespace: JOB_LOCK_NAMESPACE, key: "social:dead-weight" } as const;
/** Clans scored per batch (one hidden-score batch query per batch). */
export const CLAN_SCORE_BATCH = 100;
/** Daily clan jobs run from this UTC time of day (minutes after midnight): 00:30 UTC. */
export const CLAN_DAILY_AT_MINUTES = 30;
/** Users re-matched per pass; the rest are picked up by the next tick. */
export const RIVAL_REFRESH_BATCH = 100;

/** Runs `fn` while holding the job's lock, or returns "skipped" when another instance holds it. */
export async function withJobLock<T>(db: Db, lock: { namespace: number; key: string }, fn: () => Promise<T>): Promise<T | "skipped"> {
  return db.transaction(async (tx) => {
    const res = await tx.execute(sql`select pg_try_advisory_xact_lock(${lock.namespace}::int, hashtext(${lock.key})) as ok`);
    if (!(res.rows[0] as { ok: boolean } | undefined)?.ok) return "skipped";
    return fn();
  });
}

/**
 * Re-matches rival slots whose 30-day term ran out (slots held by an open challenge wait for it), longest
 * expired first. Stops once `budgetMs` of wall time is spent (after at least one user, so a pass always makes
 * progress); the rest is picked up by the next tick.
 */
export async function refreshExpiredRivals(
  db: Db,
  now: Date,
  limit = RIVAL_REFRESH_BATCH,
  opts: { budgetMs?: number; nowMs?: () => number } = {},
): Promise<number> {
  const budgetMs = opts.budgetMs ?? env.SOCIAL_JOB_BUDGET_MS;
  const nowMs = opts.nowMs ?? Date.now;
  const started = nowMs();
  const ids = await usersWithExpiredSlots(db, now, limit);
  let done = 0;
  for (const [i, userId] of ids.entries()) {
    try {
      await withUserLock(db, userId, (tx) => ensureAssignments(tx, userId, now));
      done++;
    } catch (err) {
      logger.error({ err, userId }, "Rival refresh failed");
    }
    if (nowMs() - started >= budgetMs && i < ids.length - 1) {
      logger.info({ done, pending: ids.length - i - 1 }, "Rival refresh stopped at its time budget");
      break;
    }
  }
  return done;
}

const utcDate = (now: Date) => now.toISOString().slice(0, 10);

/** A daily job is due once the UTC clock passes 00:30 and its stored last-run date is before today (UTC). */
async function dailyDue(db: Pick<Db, "select">, job: string, now: Date): Promise<boolean> {
  if (now.getUTCHours() * 60 + now.getUTCMinutes() < CLAN_DAILY_AT_MINUTES) return false;
  const [row] = await db.select().from(jobRuns).where(eq(jobRuns.job, job)).limit(1);
  return !row || row.lastRunDate < utcDate(now);
}

async function markRun(db: Pick<Db, "insert">, job: string, now: Date) {
  const lastRunDate = utcDate(now);
  await db.insert(jobRuns).values({ job, lastRunDate }).onConflictDoUpdate({ target: jobRuns.job, set: { lastRunDate } });
}

/**
 * Daily dead-weight pass (00:30 UTC): flags members in the clan for the whole activity window (5 full local days
 * ending yesterday) without a log in it, and clears members who no longer are dead weight. "not_due" when it already ran today (UTC) or it is before 00:30 UTC.
 */
export async function flagDeadWeight(db: Db, now: Date): Promise<{ flagged: number; cleared: number } | "not_due"> {
  if (!(await dailyDue(db, "dead-weight", now))) return "not_due";
  const out = await updateDeadWeightFlags(db, now);
  await markRun(db, "dead-weight", now);
  return out;
}

/**
 * Daily clan scores (00:30 UTC): scores every clan not yet scored today in batches, stopping once `budgetMs` is
 * spent (after at least one batch); the next tick resumes. Once every clan is scored, active clans are ranked and
 * the run is recorded. Returns the clans scored by this pass, or "not_due".
 */
export async function recomputeClanScores(
  db: Db,
  now: Date,
  opts: { budgetMs?: number; nowMs?: () => number; batchSize?: number } = {},
): Promise<number | "not_due"> {
  if (!(await dailyDue(db, "clan-scores", now))) return "not_due";
  const budgetMs = opts.budgetMs ?? env.SOCIAL_JOB_BUDGET_MS;
  const nowMs = opts.nowMs ?? Date.now;
  const batchSize = opts.batchSize ?? CLAN_SCORE_BATCH;
  const started = nowMs();
  const today = utcDate(now);
  let scored = 0;
  for (;;) {
    const pending = await db
      .select({ id: clans.id })
      .from(clans)
      .where(or(isNull(clans.scoredOn), lt(clans.scoredOn, today)))
      .orderBy(asc(clans.scoredOn), asc(clans.id))
      .limit(batchSize);
    if (pending.length === 0) {
      await assignClanRanks(db);
      await markRun(db, "clan-scores", now);
      return scored;
    }
    const deleted = await repairClans(db, pending.map((p) => p.id));
    const live = pending.map((p) => p.id).filter((id) => !deleted.has(id));
    const rows = live.length ? await db.select().from(clans).where(inArray(clans.id, live)) : [];
    const scores = await computeClanScores(db, rows, now);
    for (const r of rows) {
      const sc = scores.get(r.id) ?? { score: null, activeMemberCount: 0 };
      await db.update(clans).set({ clanScore: sc.score, activeMemberCount: sc.activeMemberCount, scoredOn: today }).where(eq(clans.id, r.id));
      scored++;
    }
    if (nowMs() - started >= budgetMs) {
      logger.info({ scored }, "Clan scores stopped at their time budget");
      return scored;
    }
  }
}

/** One pass of every social job. Cheap when nothing is due (an indexed query per job). */
export async function runSocialJobs(
  db: Db,
  now: Date,
): Promise<{
  rivalRefresh: number | "skipped";
  deadWeight: { flagged: number; cleared: number } | "not_due" | "skipped";
  clanScores: number | "not_due" | "skipped";
}> {
  const rivalRefresh = await withJobLock(db, RIVAL_JOB_LOCK, () => refreshExpiredRivals(db, now));
  const deadWeight = await withJobLock(db, DEAD_WEIGHT_JOB_LOCK, () => flagDeadWeight(db, now));
  const clanScores = await withJobLock(db, CLAN_SCORE_JOB_LOCK, () => recomputeClanScores(db, now));
  return { rivalRefresh, deadWeight, clanScores };
}
