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
