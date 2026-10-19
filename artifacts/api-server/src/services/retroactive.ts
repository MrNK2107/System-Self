import { eq } from "drizzle-orm";
import { profiles, users, type Db } from "@workspace/db";
import { localDate } from "@workspace/engine";
import type { HandlerResult } from "./idempotency";
import { isPro } from "./entitlements";

/** How far back a log may be dated for a free user. The one place every log route reads it. */
export const RETROACTIVE_LIMIT_MS = 48 * 3600_000;
/** How far back a PRO user may date a log. */
export const RETROACTIVE_PRO_LIMIT_MS = 30 * 24 * 3600_000;
export const FUTURE_TOLERANCE_MS = 5 * 60_000;

/** The 422 for an `occurredAt` that is too old for the user's tier or in the future, or null when it is acceptable at `now`. */
export function occurredAtError(now: Date, occurredAt: Date, opts: { pro: boolean }): HandlerResult | null {
  const limit = opts.pro ? RETROACTIVE_PRO_LIMIT_MS : RETROACTIVE_LIMIT_MS;
  if (now.getTime() - occurredAt.getTime() > limit) {
    return { status: 422, body: { error: "Log is too old", code: "retroactive_limit" } };
  }
  if (occurredAt.getTime() - now.getTime() > FUTURE_TOLERANCE_MS) {
    return { status: 422, body: { error: "Log is in the future", code: "future_occurred_at" } };
  }
  return null;
}

/** The 422 for a log dated before the user's onboarding local date: PRO's window must not backfill a history (and a streak) that predates the account. */
export const BEFORE_ONBOARDING: HandlerResult = {
  status: 422,
  body: { error: "Log is dated before you started", code: "before_onboarding" },
};

/**
 * What the log routes call: occurredAtError with the user's tier, then the onboarding floor (a log whose local date is
 * before the onboarding local date is 422 before_onboarding). PRO is looked up only when the log is older than the
 * free window. A user who is not onboarded passes here; the route answers 409 not_onboarded.
 */
export async function checkOccurredAt(
  db: Pick<Db, "select">,
  userId: string,
  now: Date,
  occurredAt: Date,
): Promise<HandlerResult | null> {
  const pro = now.getTime() - occurredAt.getTime() > RETROACTIVE_LIMIT_MS && (await isPro(db, userId, now));
  const bad = occurredAtError(now, occurredAt, { pro });
  if (bad) return bad;
  const [row] = await db
    .select({ onboardedAt: profiles.onboardedAt, tz: users.timezone })
    .from(profiles)
    .innerJoin(users, eq(users.id, profiles.userId))
    .where(eq(profiles.userId, userId))
    .limit(1);
  if (row && localDate(occurredAt, row.tz) < localDate(row.onboardedAt, row.tz)) return BEFORE_ONBOARDING;
  return null;
}
