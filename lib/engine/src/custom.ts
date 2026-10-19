import { addDays } from "./dates";
import { applyDelta, type StatState } from "./scoring";

/**
 * CUSTOM domains (PRD 8): user-defined stats with their own 0-100 score. They are separate from the five ranked
 * domains: none of this feeds the hidden score, rank, decay, shadow, rivals or challenges, and a custom log is not
 * ranked activity (it never moves lastActivityDate, never counts as a comeback, never protects from decay).
 */
export const CUSTOM_LIMIT_FREE = 3;
export const CUSTOM_LIMIT_PRO = 20;
export const CUSTOM_START_SCORE = 50;
/** Each custom log, before the domain's own streak multiplier. */
export const CUSTOM_LOG_DELTA = 2.5;

/** A custom log on local `date`: +2.5 with the custom domain's own streak bonus, through the same applyDelta as the ranked domains. */
export function applyCustomLog(s: StatState, date: string): { next: StatState; actualDelta: number } {
  return applyDelta(s, CUSTOM_LOG_DELTA, { bonus: true, activity: true, date });
}

/** The streak to show on `today`: a streak last continued before yesterday has lapsed (it is stored until the next log resets it). */
export function customStreakNow(streak: number, lastLogDate: string | null, today: string): number {
  if (lastLogDate === null) return 0;
  return lastLogDate >= addDays(today, -1) ? streak : 0;
}

/** How far `value` is from `baseline` towards `target`, clamped to 0..1 (either direction; baseline === target is done only at it). */
export function customProgress(baseline: number, target: number, value: number | null): number {
  if (value === null) return 0;
  if (baseline === target) return value === target ? 1 : 0;
  return Math.min(1, Math.max(0, (value - baseline) / (target - baseline)));
}
