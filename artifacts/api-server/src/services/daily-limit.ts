import { and, eq, sql } from "drizzle-orm";
import { aiUsageDaily, users, type Db } from "@workspace/db";
import { localDate } from "@workspace/engine";
import { track } from "./analytics";
import { withUserLock } from "./user-lock";

/**
 * Per-user, per-local-day call budget (cost control for the AI endpoints), kept in `ai_usage_daily`: one counter
 * per (user, local date, name). The check and the increment run under the user's lock, so concurrent calls cannot
 * slip past the limit. Returns false when the budget is spent (nothing is incremented). A call that is allowed is
 * counted before the work starts. A `name` event goes to analytics for metrics only; limits never read it.
 */
export async function consumeDailyCall(db: Db, userId: string, name: string, limit: number, now: Date): Promise<boolean> {
  return withUserLock(db, userId, async (tx) => {
    const [user] = await tx.select({ tz: users.timezone }).from(users).where(eq(users.id, userId)).limit(1);
    const day = localDate(now, user?.tz ?? "UTC");
    const [row] = await tx
      .select({ n: aiUsageDaily.count })
      .from(aiUsageDaily)
      .where(and(eq(aiUsageDaily.userId, userId), eq(aiUsageDaily.localDate, day), eq(aiUsageDaily.name, name)));
    if ((row?.n ?? 0) >= limit) return false;
    await tx
      .insert(aiUsageDaily)
      .values({ userId, localDate: day, name, count: 1 })
      .onConflictDoUpdate({
        target: [aiUsageDaily.userId, aiUsageDaily.localDate, aiUsageDaily.name],
        set: { count: sql`${aiUsageDaily.count} + 1` },
      });
    await track(tx, userId, name);
    return true;
  });
}

/** Gives back one call of today's budget (the work failed on our side, not the user's). Never goes below 0. */
export async function refundDailyCall(db: Db, userId: string, name: string, now: Date): Promise<void> {
  await withUserLock(db, userId, async (tx) => {
    const [user] = await tx.select({ tz: users.timezone }).from(users).where(eq(users.id, userId)).limit(1);
    const day = localDate(now, user?.tz ?? "UTC");
    await tx
      .update(aiUsageDaily)
      .set({ count: sql`greatest(${aiUsageDaily.count} - 1, 0)` })
      .where(and(eq(aiUsageDaily.userId, userId), eq(aiUsageDaily.localDate, day), eq(aiUsageDaily.name, name)));
  });
}
