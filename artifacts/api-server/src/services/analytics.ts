import { sql } from "drizzle-orm";
import { analyticsEvents, type Db } from "@workspace/db";
import { logger } from "../lib/logger";

type Writer = Pick<Db, "transaction">;

/**
 * Records one product analytics event. Never throws: a failed insert is logged and dropped. Pass a request
 * transaction and the insert runs in a savepoint, so a failure cannot abort the caller's transaction.
 * Callers await it inside their transaction (a pending query must not outlive the commit).
 */
export async function track(
  db: Writer,
  userId: string | null,
  name: string,
  props: Record<string, unknown> = {},
): Promise<void> {
  try {
    await db.transaction(async (t) => {
      await t.insert(analyticsEvents).values({ userId, name, props });
    });
  } catch (err) {
    logger.warn({ err, event: name }, "analytics track failed");
  }
}

/** Product analytics are kept 90 days (admin adherence metrics count floor events within that horizon). */
export const ANALYTICS_EVENT_TTL_MS = 90 * 86_400_000;

/**
 * Deletes analytics_events older than 90 days in bounded batches (at most `maxBatches` per call, backed by the
 * created_at index); the rest waits for the next tick. Returns the rows deleted.
 */
export async function pruneAnalyticsEvents(db: Db, now: Date, opts: { batch?: number; maxBatches?: number } = {}): Promise<number> {
  const batch = opts.batch ?? 1000;
  const maxBatches = opts.maxBatches ?? 5;
  const cutoff = new Date(now.getTime() - ANALYTICS_EVENT_TTL_MS);
  let total = 0;
  for (let i = 0; i < maxBatches; i++) {
    const res = await db.execute(
      sql`delete from analytics_events where id in (select id from analytics_events where created_at < ${cutoff} limit ${batch})`,
    );
    total += res.rowCount ?? 0;
    if ((res.rowCount ?? 0) < batch) break;
  }
  return total;
}
