// Social jobs run from the worker loop. Each job holds a transaction-scoped advisory lock (its own key in the
// job namespace) while it runs, so with several worker instances one instance runs each job at a time.
import { sql } from "drizzle-orm";
import type { Db } from "@workspace/db";
import { logger } from "../lib/logger";
import { ensureAssignments, usersWithExpiredSlots } from "../services/rivals";
import { withUserLock } from "../services/user-lock";

/** Two-key advisory locks (namespace, hashtext(key)) never collide with the per-user one-key locks. */
export const JOB_LOCK_NAMESPACE = 5501;
export const RIVAL_JOB_LOCK = { namespace: JOB_LOCK_NAMESPACE, key: "social:rival-refresh" } as const;
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

/** Re-matches rival slots whose 30-day term ran out (slots held by an open challenge wait for it). */
export async function refreshExpiredRivals(db: Db, now: Date, limit = RIVAL_REFRESH_BATCH): Promise<number> {
  const ids = await usersWithExpiredSlots(db, now, limit);
  let done = 0;
  for (const userId of ids) {
    try {
      await withUserLock(db, userId, (tx) => ensureAssignments(tx, userId, now));
      done++;
    } catch (err) {
      logger.error({ err, userId }, "Rival refresh failed");
    }
  }
  return done;
}

/** One pass of every social job. Cheap when nothing is due (an indexed query per job). */
export async function runSocialJobs(db: Db, now: Date): Promise<{ rivalRefresh: number | "skipped" }> {
  const rivalRefresh = await withJobLock(db, RIVAL_JOB_LOCK, () => refreshExpiredRivals(db, now));
  return { rivalRefresh };
}
