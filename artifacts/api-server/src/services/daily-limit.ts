import { and, count, eq, gte, lt } from "drizzle-orm";
import { analyticsEvents, users, type Db } from "@workspace/db";
import { addDays, endOfLocalDay, localDate } from "@workspace/engine";
import { withUserLock } from "./user-lock";

/**
 * Per-user, per-local-day call budget (cost control for the AI endpoints). Each call is one `analytics_events` row
 * named `name` (a row stamped with the request clock), counted over the user's local day. Counting and recording
 * happen under the user's lock, so concurrent calls cannot slip past the limit. Returns false when the budget is
 * spent (the call is not recorded); a call that is allowed is recorded before the work starts, so failures count.
 */
export async function consumeDailyCall(db: Db, userId: string, name: string, limit: number, now: Date): Promise<boolean> {
  return withUserLock(db, userId, async (tx) => {
    const [user] = await tx.select({ tz: users.timezone }).from(users).where(eq(users.id, userId)).limit(1);
    const today = localDate(now, user?.tz ?? "UTC");
    const tz = user?.tz ?? "UTC";
    const from = endOfLocalDay(addDays(today, -1), tz);
    const to = endOfLocalDay(today, tz);
    const [row] = await tx
      .select({ n: count() })
      .from(analyticsEvents)
      .where(and(eq(analyticsEvents.userId, userId), eq(analyticsEvents.name, name), gte(analyticsEvents.createdAt, from), lt(analyticsEvents.createdAt, to)));
    if ((row?.n ?? 0) >= limit) return false;
    await tx.insert(analyticsEvents).values({ userId, name, createdAt: now });
    return true;
  });
}
