// Small pure helpers for the quest screen. No React Native imports.
import { ApiError } from "../api/client";

/** True for an ApiError carrying the server's `code` (e.g. not_active, refusal_limit, chain_active). */
export function hasApiCode(error: unknown, code: string): boolean {
  return error instanceof ApiError && error.code === code;
}

/** `YYYY-Www`: the ISO week (Monday start) of the device's local date. */
export function isoWeekKey(now: Date): string {
  const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day); // the Thursday of this week decides the year
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export const REFUSAL_RULE = "First refusal this week is logged. The second costs 1.5 DISCIPLINE. There is no third.";

export type FailedMutation = { ok: false; reason: "sync_pending" } | { ok: false; reason: "error"; error: unknown };

/** One SYSTEM-voice line for a failed request; sync_pending is explained by the OFFLINE bar as well. */
export function mutationFailureLine(r: FailedMutation): string {
  if (r.reason === "sync_pending") return "Sync pending. Queued logs must land first.";
  if (r.error instanceof ApiError && r.error.kind === "network") return "No connection. Nothing was sent.";
  return "Request failed. Try again.";
}

/** not_active: it was already resolved (another tap, another device). The refetch that follows shows it. */
export const isStaleFailure = (r: FailedMutation): boolean => r.reason === "error" && hasApiCode(r.error, "not_active");

/** The line a failed refusal shows, on every screen that refuses; null when there is nothing to say (stale). */
export function refuseFailureLine(r: FailedMutation): string | null {
  if (r.reason === "error" && hasApiCode(r.error, "refusal_limit")) return REFUSAL_RULE;
  if (r.reason === "error" && hasApiCode(r.error, "reason_required")) return "A reason is required.";
  if (isStaleFailure(r)) return null;
  return mutationFailureLine(r);
}
