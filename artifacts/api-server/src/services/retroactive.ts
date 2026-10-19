import type { Db } from "@workspace/db";
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

/**
 * What the log routes call: occurredAtError with the user's tier. PRO is looked up only when the log is older than the
 * free window, so the common path (a log from the last two days) costs no query.
 */
export async function checkOccurredAt(
  db: Pick<Db, "select">,
  userId: string,
  now: Date,
  occurredAt: Date,
): Promise<HandlerResult | null> {
  const pro = now.getTime() - occurredAt.getTime() > RETROACTIVE_LIMIT_MS && (await isPro(db, userId, now));
  return occurredAtError(now, occurredAt, { pro });
}
