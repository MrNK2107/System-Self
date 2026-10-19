import { setTimeout as sleep } from "node:timers/promises";
import { inArray, lt } from "drizzle-orm";
import { idempotencyKeys, userDayState, type Db } from "@workspace/db";
import { logger } from "../lib/logger";
import { claimDueUsers, ensureRolledOver } from "../services/rollover";
import { runSocialJobs } from "./social";
import { prunePushLogs, runNotificationJobs } from "./notifications";
import { createExpoTransport, type PushTransport } from "../services/push";
import { env } from "../lib/env";
import { jobDuration, rolloverUsers, timeJob } from "../lib/metrics";
import { pruneBillingEvents } from "../services/entitlements";

export const WORKER_BATCH_SIZE = 200;
const defaultPushTransport = () => createExpoTransport({ accessToken: env.EXPO_ACCESS_TOKEN });
export const IDEMPOTENCY_KEY_TTL_MS = 7 * 86_400_000;

/**
 * One worker pass: claims up to `batchSize` due users and rolls each over, runs the social jobs (rival
 * re-matching), the notification jobs (quest-deadline notice, push dispatch), then prunes push logs (30 days), billing events (180 days) and idempotency keys (7 days). If `signal` aborts mid-batch, the current user finishes and the remaining claimed
 * users are released (made due again) for the next worker.
 */
export async function runWorkerTick(
  db: Db,
  now: Date,
  signal?: AbortSignal,
  batchSize = WORKER_BATCH_SIZE,
  push: PushTransport = defaultPushTransport(),
  prune: (db: Db, now: Date) => Promise<unknown> = prunePushLogs,
): Promise<{ processed: number; claimed: number }> {
  const ids = await claimDueUsers(db, batchSize, now);
  let processed = 0;
  const endRollover = jobDuration.startTimer({ job: "rollover" });
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
      rolloverUsers.inc();
    } catch (err) {
      // The claim lease expires, so this user is retried by a later tick.
      logger.error({ err, userId }, "Rollover failed");
    }
  }
  endRollover();
  if (!signal?.aborted) {
    try {
      await timeJob("social", () => runSocialJobs(db, now));
    } catch (err) {
      logger.error({ err }, "Social jobs failed");
    }
  }
  if (!signal?.aborted) {
    try {
      await timeJob("notifications", () => runNotificationJobs(db, now, push));
    } catch (err) {
      logger.error({ err }, "Notification jobs failed");
    }
  }
  try {
    await prune(db, now);
  } catch (err) {
    logger.error({ err }, "Push log prune failed");
  }
  try {
    await pruneBillingEvents(db, now);
  } catch (err) {
    logger.error({ err }, "Billing event prune failed");
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
  opts: { tickMs: number; signal: AbortSignal; batchSize?: number; clock?: () => Date; push?: PushTransport },
): Promise<void> {
  const batchSize = opts.batchSize ?? WORKER_BATCH_SIZE;
  const clock = opts.clock ?? (() => new Date());
  while (!opts.signal.aborted) {
    const started = Date.now();
    let fullBatch = false;
    try {
      const { processed, claimed } = await runWorkerTick(db, clock(), opts.signal, batchSize, opts.push);
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
