// Today's planned session at a glance: how many exercises and a rough duration. Pure, no React Native imports.

/** Seconds a working set takes before its rest (a coarse average across lifts). */
export const SET_WORK_SEC = 40;

interface Block {
  exerciseId: string;
  sets: number;
  restSec: number;
}

/** Distinct exercises in the day's blocks. */
export function exerciseCount(blocks: readonly Block[]): number {
  return new Set(blocks.map((b) => b.exerciseId)).size;
}

/**
 * Estimated minutes for the day: every set's work plus its rest (no rest after the last set of the day),
 * rounded up to the next 5 minutes. 0 for an empty day.
 */
export function estimateMinutes(blocks: readonly Block[]): number {
  let sec = 0;
  let sets = 0;
  let lastRest = 0;
  for (const b of blocks) {
    const n = Math.max(0, Math.floor(b.sets));
    if (n === 0) continue;
    const rest = Math.max(0, b.restSec);
    sec += n * (SET_WORK_SEC + rest);
    sets += n;
    lastRest = rest;
  }
  if (sets === 0) return 0;
  sec -= lastRest;
  return Math.max(5, Math.ceil(sec / 60 / 5) * 5);
}

/** "4 exercises · about 45 min". */
export function sessionSummary(blocks: readonly Block[]): string {
  const n = exerciseCount(blocks);
  const min = estimateMinutes(blocks);
  return `${n} ${n === 1 ? "exercise" : "exercises"} · about ${min} min`;
}
