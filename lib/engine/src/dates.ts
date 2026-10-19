const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

function parts(at: Date, timeZone: string) {
  const out: Record<string, number> = {};
  for (const p of formatter(timeZone).formatToParts(at)) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  return out as { year: number; month: number; day: number; hour: number; minute: number; second: number };
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

function parseDate(date: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) throw new Error(`Invalid date: ${date}`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function fmtUtc(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

const DAY_MS = 86_400_000;

/** Local calendar date (YYYY-MM-DD) of an instant in an IANA timezone. */
export function localDate(at: Date, timeZone: string): string {
  const p = parts(at, timeZone);
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`;
}

/** Local hour of day (0-23) of an instant in an IANA timezone. */
export function localHour(at: Date, timeZone: string): number {
  return parts(at, timeZone).hour;
}

export function addDays(date: string, n: number): string {
  return fmtUtc(parseDate(date) + n * DAY_MS);
}

/** Whole days from a to b (b - a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((parseDate(b) - parseDate(a)) / DAY_MS);
}

/** ISO 8601 week key, `YYYY-Www`. */
export function isoWeekKey(date: string): string {
  const d = new Date(parseDate(date));
  const dow = d.getUTCDay() || 7; // Mon=1..Sun=7
  d.setUTCDate(d.getUTCDate() + 4 - dow); // Thursday of this week
  const year = d.getUTCFullYear();
  const week = Math.ceil(((d.getTime() - Date.UTC(year, 0, 1)) / DAY_MS + 1) / 7);
  return `${pad(year, 4)}-W${pad(week)}`;
}

/** Offset (ms) of the timezone from UTC at the given instant. */
function offsetAt(at: Date, timeZone: string): number {
  const p = parts(at, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/**
 * The instant of the next local midnight after `date` (exclusive end of that
 * local day), correct across DST transitions.
 */
export function endOfLocalDay(date: string, timeZone: string): Date {
  const wall = parseDate(addDays(date, 1)); // next local midnight as if UTC
  // Iterate: guess the instant using the offset at the guess; settles in 2 steps.
  let guess = wall - offsetAt(new Date(wall), timeZone);
  guess = wall - offsetAt(new Date(guess), timeZone);
  let result = new Date(guess);
  // If midnight does not exist (gap), the guess lands after it; step back to the first valid instant.
  const p = parts(result, timeZone);
  if (Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) !== wall) {
    const alt = new Date(wall - offsetAt(new Date(wall - DAY_MS / 2), timeZone));
    const q = parts(alt, timeZone);
    if (Date.UTC(q.year, q.month - 1, q.day, q.hour, q.minute, q.second) === wall) result = alt;
  }
  return result;
}

/** The instant of local wall-clock `hour:minute` on `date` in an IANA timezone (DST-safe; settles in 2 steps). */
export function localTimeToInstant(date: string, hour: number, minute: number, timeZone: string): Date {
  const wall = parseDate(date) + (hour * 60 + minute) * 60_000;
  let guess = wall - offsetAt(new Date(wall), timeZone);
  guess = wall - offsetAt(new Date(guess), timeZone);
  return new Date(guess);
}
