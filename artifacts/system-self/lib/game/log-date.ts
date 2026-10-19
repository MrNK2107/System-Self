// Which day a log is dated (the log modal's date chooser): plain module, no React Native imports.
// The server holds the real limits (48 h for everyone, 30 days for PRO); these mirror them so the chooser can lock
// what a free user cannot pick, and so a chosen day always lands inside the window the server will accept.
import { addDays } from "@workspace/engine";
import { todayInZone } from "./life";

export const FREE_DAYS_BACK = 2;
export const PRO_DAYS_BACK = 30;
const HOUR_MS = 3600_000;
const DAY_MS = 24 * HOUR_MS;
/** Kept inside the server's window so a log queued offline for a few minutes is not refused for being 48 h and a moment old. */
const WINDOW_MARGIN_MS = 5 * 60_000;

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

export interface DayOption {
  daysBack: number;
  /** The local date (YYYY-MM-DD) in the account timezone. */
  date: string;
  /** TODAY, YESTERDAY, or `Tue 3 Mar`. */
  label: string;
  /** True when this day is further back than a free user may log. */
  locked: boolean;
}

function dayLabel(daysBack: number, date: string): string {
  if (daysBack === 0) return "Today";
  if (daysBack === 1) return "Yesterday";
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return `${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${d} ${MONTHS[m - 1]}`;
}

/** Every day the chooser can show, today first, up to 30 days back; days past the free limit are locked unless `pro`. */
export function dayOptions(now: Date, tz: string | null | undefined, pro: boolean, fallbackTz = "UTC"): DayOption[] {
  const today = todayInZone(tz, now, fallbackTz);
  return Array.from({ length: PRO_DAYS_BACK + 1 }, (_, daysBack) => {
    const date = addDays(today, -daysBack);
    return { daysBack, date, label: dayLabel(daysBack, date), locked: !pro && daysBack > FREE_DAYS_BACK };
  });
}

/**
 * The `occurredAt` for a log dated `daysBack` days ago: now for today, else the same time of day that many days back,
 * never older than the user's window allows (the last moments of the free 2nd day or the PRO 30th are trimmed).
 */
export function occurredAtFor(now: Date, daysBack: number, pro: boolean): string {
  if (daysBack <= 0) return now.toISOString();
  const limit = (pro ? PRO_DAYS_BACK : FREE_DAYS_BACK) * DAY_MS;
  return new Date(now.getTime() - Math.min(daysBack * DAY_MS, limit - WINDOW_MARGIN_MS)).toISOString();
}
