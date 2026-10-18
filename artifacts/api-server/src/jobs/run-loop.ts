import { setTimeout as sleep } from "node:timers/promises";
import { inArray, lt } from "drizzle-orm";
import { idempotencyKeys, userDayState, type Db } from "@workspace/db";
import { logger } from "../lib/logger";
import { claimDueUsers, ensureRolledOver } from "../services/rollover";

export const WORKER_BATCH_SIZE = 200;
export const IDEMPOTENCY_KEY_TTL_MS = 7 * 86_400_000;

/**
 * One worker pass: claims up to `batchSize` due users and rolls each over, then prunes idempotency keys
 * older than 7 days. If `signal` aborts mid-batch, the current user finishes and the remaining claimed
 * users are released (made due again) for the next worker.
 */
export async function runWorkerTick(
  db: Db,
  now: Date,
  signal?: AbortSignal,
  batchSize = WORKER_BATCH_SIZE,
): Promise<{ processed: number; claimed: number }> {
  const ids = await claimDueUsers(db, batchSize, now);
  let processed = 0;
  for (const [i, userId] of ids.entries()) {
    if (signal?.aborted) {
      await db
        .update(userDayState)
        .set({ nextRolloverAt: now })
        .where(inArray(userDayState.userId, ids.slice(i)));
      break;
    }
    try {
      await ensureRolledOver(db, userId, now);
      processed++;
    } catch (err) {
      // The claim lease expires, so this user is retried by a later tick.
      logger.error({ err, userId }, "Rollover failed");
    }
  }
  await db.delete(idempotencyKeys).where(lt(idempotencyKeys.createdAt, new Date(now.getTime() - IDEMPOTENCY_KEY_TTL_MS)));
  return { processed, claimed: ids.length };
}

/**
 * Runs worker ticks until `signal` aborts; resolves after the in-flight tick finishes. Sleeps `tickMs`
 * between ticks, except after a full batch (more users are probably due), when it re-ticks at once.
 */
export async function runLoop(
  db: Db,
  opts: { tickMs: number; signal: AbortSignal; batchSize?: number; clock?: () => Date },
): Promise<void> {
  const batchSize = opts.batchSize ?? WORKER_BATCH_SIZE;
  const clock = opts.clock ?? (() => new Date());
  while (!opts.signal.aborted) {
    const started = Date.now();
    let fullBatch = false;
    try {
      const { processed, claimed } = await runWorkerTick(db, clock(), opts.signal, batchSize);
      fullBatch = claimed >= batchSize;
      logger.info({ processed, ms: Date.now() - started }, "Worker tick");
    } catch (err) {
      logger.error({ err }, "Worker tick failed");
    }
    if (fullBatch) continue;
    try {
      await sleep(Math.max(0, opts.tickMs - (Date.now() - started)), undefined, { signal: opts.signal });
    } catch {
      // aborted: exit the loop
    }
  }
}
