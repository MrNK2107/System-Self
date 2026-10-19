import type { HandlerResult } from "./idempotency";

/** How far back a log may be dated for everyone (PRO gets 30 days in P6 Task 6). The one place every log route reads it. */
export const RETROACTIVE_LIMIT_MS = 48 * 3600_000;
export const FUTURE_TOLERANCE_MS = 5 * 60_000;

/** The 422 for an `occurredAt` that is too old or in the future, or null when it is acceptable at `now`. */
export function occurredAtError(now: Date, occurredAt: Date): HandlerResult | null {
  if (now.getTime() - occurredAt.getTime() > RETROACTIVE_LIMIT_MS) {
    return { status: 422, body: { error: "Log is too old", code: "retroactive_limit" } };
  }
  if (occurredAt.getTime() - now.getTime() > FUTURE_TOLERANCE_MS) {
    return { status: 422, body: { error: "Log is in the future", code: "future_occurred_at" } };
  }
  return null;
}
