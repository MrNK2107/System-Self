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
