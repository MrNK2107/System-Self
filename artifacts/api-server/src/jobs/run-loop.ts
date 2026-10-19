import { setTimeout as sleep } from "node:timers/promises";
import { inArray, sql } from "drizzle-orm";
import { userDayState, type Db } from "@workspace/db";
import { logger } from "../lib/logger";
import { claimDueUsers, ensureRolledOver } from "../services/rollover";
import { runSocialJobs } from "./social";
import { ORPHAN_PUSH_TOKEN_TTL_MS, PRUNE_BATCH, PRUNE_MAX_BATCHES, pruneOrphanedPushTokens, prunePushLogs, runNotificationJobs } from "./notifications";
import { createExpoTransport, type PushTransport } from "../services/push";
import { env } from "../lib/env";
import { jobDuration, recordWorkerTick, rolloverUsers, timeJob } from "../lib/metrics";
import { pruneBillingEvents } from "../services/entitlements";
import { pruneAnalyticsEvents } from "../services/analytics";
import { closeAbandonedGymSessions } from "../services/gym";

export const WORKER_BATCH_SIZE = 200;
const defaultPushTransport = () => createExpoTransport({ accessToken: env.EXPO_ACCESS_TOKEN });
export const IDEMPOTENCY_KEY_TTL_MS = 7 * 86_400_000;

type PruneOpts = { batch?: number; maxBatches?: number };

/** Runs `deleteBatch(limit)` up to maxBatches times, stopping at a short batch. Returns the rows deleted. */
async function boundedDelete(opts: PruneOpts, deleteBatch: (limit: number) => Promise<{ rowCount?: number | null }>): Promise<number> {
  const batch = opts.batch ?? PRUNE_BATCH;
  const maxBatches = opts.maxBatches ?? PRUNE_MAX_BATCHES;
  let total = 0;
  for (let i = 0; i < maxBatches; i++) {
    const n = (await deleteBatch(batch)).rowCount ?? 0;
    total += n;
    if (n < batch) break;
  }
  return total;
}

/** Deletes idempotency keys older than 7 days in bounded batches (indexed by created_at). Returns the rows deleted. */
export function pruneIdempotencyKeys(db: Db, now: Date, opts: PruneOpts = {}): Promise<number> {
  const cutoff = new Date(now.getTime() - IDEMPOTENCY_KEY_TTL_MS);
  return boundedDelete(opts, (limit) =>
    db.execute(sql`
      delete from idempotency_keys where (user_id, key) in (
        select user_id, key from idempotency_keys where created_at < ${cutoff} limit ${limit}
      )`),
  );
}

/**
 * How long a refresh_tokens row is kept after it stopped being valid (least of expires_at and revoked_at). Two
 * readers need old rows:
 * - reuse detection (rotateRefreshToken): presenting a rotated (revoked) token revokes its whole family, but only
 *   while the row exists; once pruned the token is merely "invalid". A rotated token is revoked no earlier than it
 *   was issued and expires REFRESH_TOKEN_TTL_DAYS after issue, so a retention of at least the TTL keeps every row
 *   until it would have expired anyway: a stolen token can never outlive its revoked row.
 * - pruneOrphanedPushTokens: needs every token whose validity ended within ORPHAN_PUSH_TOKEN_TTL_MS.
 * 30 days with the default TTL (30 days).
 */
export const REFRESH_TOKEN_RETENTION_MS = Math.max(env.REFRESH_TOKEN_TTL_DAYS * 86_400_000, ORPHAN_PUSH_TOKEN_TTL_MS);
/** Email codes live 15 minutes; expired or consumed ones are kept one more day for support, then deleted. */
export const EMAIL_CODE_RETENTION_MS = 86_400_000;

/**
 * Deletes refresh tokens that stopped being valid (expired or revoked) more than REFRESH_TOKEN_RETENTION_MS ago, in
 * bounded batches (refresh_tokens_expires_at_idx and refresh_tokens_revoked_at_idx). Returns the rows deleted.
 */
export function pruneRefreshTokens(db: Db, now: Date, opts: PruneOpts = {}): Promise<number> {
  const cutoff = new Date(now.getTime() - REFRESH_TOKEN_RETENTION_MS);
  return boundedDelete(opts, (limit) =>
    db.execute(sql`
      delete from refresh_tokens where id in (
        select id from refresh_tokens where expires_at < ${cutoff} or revoked_at < ${cutoff} limit ${limit}
      )`),
  );
}

/**
 * Deletes email codes a day after they expired (email_codes_expires_at_idx). A consumed code is consumed before it
 * expires or is already expired, so this also covers consumed codes: none outlives creation + 15 min + 1 day.
 * The hourly per-account code cap only counts the last hour, so it never needs pruned rows. Returns the rows deleted.
 */
export function pruneEmailCodes(db: Db, now: Date, opts: PruneOpts = {}): Promise<number> {
  const cutoff = new Date(now.getTime() - EMAIL_CODE_RETENTION_MS);
  return boundedDelete(opts, (limit) =>
    db.execute(sql`delete from email_codes where id in (select id from email_codes where expires_at < ${cutoff} limit ${limit})`),
  );
}

/**
 * One worker pass: claims up to `batchSize` due users and rolls each over, runs the social jobs (rival
 * re-matching), the notification jobs (quest-deadline notice, push dispatch), then (unless `signal` aborted) sweeps abandoned gym sessions and prunes push logs (30 days), billing events (180 days), orphaned push tokens, analytics events (90 days), idempotency keys (7 days), refresh tokens (REFRESH_TOKEN_RETENTION_MS) and email codes (EMAIL_CODE_RETENTION_MS), each bounded and isolated (a failure is logged and the rest still run). If `signal` aborts mid-batch, the current user finishes and the remaining claimed
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
  // Housekeeping is skipped once shutdown began: the in-flight tick must end within the stop grace period.
  if (signal?.aborted) return { processed, claimed: ids.length };
  const housekeeping: [string, () => Promise<unknown>][] = [
    ["Push log prune failed", () => prune(db, now)],
    ["Billing event prune failed", () => pruneBillingEvents(db, now)],
    ["Orphaned push token prune failed", () => pruneOrphanedPushTokens(db, now)],
    ["Abandoned gym session sweep failed", () => closeAbandonedGymSessions(db, now)],
    ["Analytics event prune failed", () => pruneAnalyticsEvents(db, now)],
    ["Idempotency key prune failed", () => pruneIdempotencyKeys(db, now)],
    ["Refresh token prune failed", () => pruneRefreshTokens(db, now)],
    ["Email code prune failed", () => pruneEmailCodes(db, now)],
  ];
  for (const [message, run] of housekeeping) {
    if (signal?.aborted) break;
    try {
      await run();
    } catch (err) {
      logger.error({ err }, message);
    }
  }
  return { processed, claimed: ids.length };
}

/**
 * Runs worker ticks until `signal` aborts; resolves after the in-flight tick finishes. Sleeps `tickMs`
 * between ticks, except after a full batch (more users are probably due), when it re-ticks at once. After each
 * completed tick it sets worker_last_tick_timestamp_seconds and calls `onTick`.
 */
export async function runLoop(
  db: Db,
  opts: {
    tickMs: number;
    signal: AbortSignal;
    batchSize?: number;
    clock?: () => Date;
    push?: PushTransport;
    /** Runs after each completed tick (the worker touches its heartbeat file here); its errors are logged. */
    onTick?: () => Promise<void> | void;
  },
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
      // Only a completed tick counts: a worker whose ticks keep failing (e.g. database down) goes stale.
      recordWorkerTick();
      try {
        await opts.onTick?.();
      } catch (err) {
        logger.warn({ err }, "Worker onTick hook failed");
      }
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
