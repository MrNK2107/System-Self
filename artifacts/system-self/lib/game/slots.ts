// Lock the Slot: pure helpers for the slot picker and the missed-slot banner. No React Native imports.
import type { Quest } from "./types";

export const SLOT_STEP_MIN = 15;
export const SLOT_MAX_MIN = 240;
/** Window lengths offered by the picker, in minutes (all within the 4 h cap). */
export const SLOT_DURATIONS = [30, 45, 60, 90, 120, 180, 240] as const;

export const toHHMM = (minutes: number): string =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
export const fromHHMM = (t: string): number => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/** Start times in 15-minute steps across the day. */
export function slotStartOptions(): string[] {
  const out: string[] = [];
  for (let m = 0; m < 24 * 60; m += SLOT_STEP_MIN) out.push(toHHMM(m));
  return out;
}

/** Durations that still end on the same day for this start. */
export function durationsFor(start: string): number[] {
  return SLOT_DURATIONS.filter((d) => fromHHMM(start) + d <= 23 * 60 + 59);
}

/** The window for a start and duration, or null if it would leave the day or exceed 4 h. */
export function buildSlot(start: string, durationMin: number): { slotStart: string; slotEnd: string } | null {
  if (durationMin <= 0 || durationMin > SLOT_MAX_MIN) return null;
  const end = fromHHMM(start) + durationMin;
  if (end > 23 * 60 + 59) return null;
  return { slotStart: start, slotEnd: toHHMM(end) };
}

export const slotLabel = (q: Pick<Quest, "slotStart" | "slotEnd">): string | null =>
  q.slotStart && q.slotEnd ? `${q.slotStart}\u2013${q.slotEnd}` : null;

/**
 * The wall clock of `now` in `tz` (the account timezone, as the server judges slots); the device's own when `tz`
 * is empty or unknown.
 */
function wallClock(now: Date, tz?: string | null): { day: string; minutes: number } {
  if (tz) {
    try {
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: tz,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).formatToParts(now);
      const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
      return { day: `${get("year")}-${get("month")}-${get("day")}`, minutes: (Number(get("hour")) % 24) * 60 + Number(get("minute")) };
    } catch {
      // unknown zone: the device clock below
    }
  }
  return { day: `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`, minutes: now.getHours() * 60 + now.getMinutes() };
}

export const nowHHMM = (now: Date, tz?: string | null): string => toHHMM(wallClock(now, tz).minutes);

const localDay = (d: Date, tz?: string | null): string => wallClock(d, tz).day;

/**
 * The first active daily BODY quest whose chosen slot has passed. The server's slotState (computed when the list
 * was fetched, at `computedAt`) is the source of truth. The local clock (in `tz`, the account timezone; else the
 * device's) may only move upcoming/open to missed, and only on the same local date the state was computed for;
 * after midnight nothing is trusted until a refetch. A resolved quest never counts.
 */
export function missedSlotQuest(quests: readonly Quest[], now: Date, computedAt: Date, tz?: string | null): Quest | null {
  if (localDay(now, tz) !== localDay(computedAt, tz)) return null;
  const t = nowHHMM(now, tz);
  return (
    quests.find(
      (q) =>
        q.status === "active" &&
        q.domain === "BODY" &&
        q.type === "daily" &&
        q.slotStart !== undefined &&
        q.slotEnd !== undefined &&
        (q.slotState === "missed" || ((q.slotState === "upcoming" || q.slotState === "open") && t > q.slotEnd)),
    ) ?? null
  );
}

/** True when the local date (in `tz`, else the device's) has moved on since the quest list was computed (time to refetch). */
export const slotStateStale = (now: Date, computedAt: Date, tz?: string | null): boolean =>
  localDay(now, tz) !== localDay(computedAt, tz);

export const missedSlotLine = (slotStart: string, now: Date, tz?: string | null): string =>
  `You chose ${slotStart}. It is ${nowHHMM(now, tz)}.`;
