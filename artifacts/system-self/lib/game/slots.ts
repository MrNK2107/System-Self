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

export const nowHHMM = (now: Date): string => toHHMM(now.getHours() * 60 + now.getMinutes());

/**
 * The first active BODY quest whose chosen slot has passed. Trusts the server's slotState and also the device
 * clock, since the list can be minutes old. A resolved quest never counts.
 */
export function missedSlotQuest(quests: readonly Quest[], now: Date): Quest | null {
  const t = nowHHMM(now);
  return (
    quests.find(
      (q) =>
        q.status === "active" &&
        q.domain === "BODY" &&
        q.slotStart !== undefined &&
        q.slotEnd !== undefined &&
        (q.slotState === "missed" || t > q.slotEnd),
    ) ?? null
  );
}

export const missedSlotLine = (slotStart: string, now: Date): string => `You chose ${slotStart}. It is ${nowHHMM(now)}.`;
