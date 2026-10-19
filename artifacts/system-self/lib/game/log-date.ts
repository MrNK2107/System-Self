// Which day a log is dated (the log modal's date chooser): plain module, no React Native imports.
// The server holds the real limits (48 h for everyone, 30 days for PRO); these mirror them so the chooser can lock
// what a free user cannot pick, and so a chosen day always lands inside the window the server will accept.
import { addDays, endOfLocalDay, localDate } from "@workspace/engine";

export const FREE_DAYS_BACK = 2;
export const PRO_DAYS_BACK = 30;
const HOUR_MS = 3600_000;
const DAY_MS = 24 * HOUR_MS;
/** A day is offered only when its timestamp is at least this far inside the server's window (sync delay, clock skew). */
const WINDOW_MARGIN_MS = HOUR_MS;
/** The instant sent for a past day: 23:59:00 local, one minute before that day ends. */
const END_OF_DAY_OFFSET_MS = 60_000;

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

export interface DayOption {
  daysBack: number;
  /** The local date (YYYY-MM-DD) in the account timezone. */
  date: string;
  /** Today, Yesterday, or `Tue 3 Mar`. */
  label: string;
  /** The `occurredAt` to send for this day; its local date is always `date`. */
  occurredAt: string;
  /** True when this day is further back than a free user may log (shown as a ProLock). */
  locked: boolean;
  /** False when the day is unlocked but its timestamp is not at least 1 hour inside the window (hidden near midnight). */
  offered: boolean;
}

function dayLabel(daysBack: number, date: string): string {
  if (daysBack === 0) return "Today";
  if (daysBack === 1) return "Yesterday";
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return `${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${d} ${MONTHS[m - 1]}`;
}

/** The first of `tz`, `fallbackTz`, UTC that the runtime knows. */
function usableZone(tz: string | null | undefined, fallbackTz: string, now: Date): string {
  for (const zone of [tz, fallbackTz, "UTC"]) {
    if (!zone) continue;
    try {
      localDate(now, zone);
      return zone;
    } catch {
      // unknown zone: try the next one
    }
  }
  return "UTC";
}

/**
 * Every day the chooser can show, today first, up to 30 days back. A past day is sent as min(now, 23:59:00 local on that
 * day), so its date is exactly the label's. Days past the free limit are locked unless `pro`; an unlocked day whose
 * timestamp is not at least 1 hour inside the window (free 48 h, PRO 30 days) is not offered.
 */
export function dayOptions(now: Date, tz: string | null | undefined, pro: boolean, fallbackTz = "UTC"): DayOption[] {
  const zone = usableZone(tz, fallbackTz, now);
  const today = localDate(now, zone);
  const windowMs = (pro ? PRO_DAYS_BACK : FREE_DAYS_BACK) * DAY_MS;
  return Array.from({ length: PRO_DAYS_BACK + 1 }, (_, daysBack) => {
    const date = addDays(today, -daysBack);
    const at = daysBack === 0 ? now : new Date(Math.min(now.getTime(), endOfLocalDay(date, zone).getTime() - END_OF_DAY_OFFSET_MS));
    const locked = !pro && daysBack > FREE_DAYS_BACK;
    return {
      daysBack,
      date,
      label: dayLabel(daysBack, date),
      occurredAt: at.toISOString(),
      locked,
      offered: !locked && now.getTime() - at.getTime() <= windowMs - WINDOW_MARGIN_MS,
    };
  });
}
