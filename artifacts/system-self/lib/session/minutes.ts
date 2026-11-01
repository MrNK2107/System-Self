// Live-session movement maths, kept free of React Native so it can be unit-tested.
import { ACTIVE_MINUTE_STD_G } from "@workspace/engine";

/** Running totals for the minute being measured, plus how many finished minutes were active. */
export interface MovementState {
  /** Start of the current minute bucket, ms since epoch. */
  minuteStart: number;
  n: number;
  sum: number;
  sumSq: number;
  activeMinutes: number;
  /** Finished minutes with enough samples to judge (the phone was awake and measuring). */
  measuredMinutes: number;
}

/** A finished minute needs this many samples to count (the phone samples at ~10 Hz). */
export const MIN_SAMPLES_PER_MINUTE = 30;

export const newMovement = (now: number): MovementState => ({
  minuteStart: now,
  n: 0,
  sum: 0,
  sumSq: 0,
  activeMinutes: 0,
  measuredMinutes: 0,
});

function closeMinute(s: MovementState): MovementState {
  if (s.n < MIN_SAMPLES_PER_MINUTE) return s;
  const mean = s.sum / s.n;
  const std = Math.sqrt(Math.max(0, s.sumSq / s.n - mean * mean));
  return { ...s, measuredMinutes: s.measuredMinutes + 1, activeMinutes: s.activeMinutes + (std >= ACTIVE_MINUTE_STD_G ? 1 : 0) };
}

/**
 * Adds one accelerometer sample (x, y, z in g) taken at `at`. When the sample falls in a later minute, the previous
 * minute is judged active or not (standard deviation of magnitude ≥ the engine threshold) and a new bucket starts.
 */
export function addSample(s: MovementState, x: number, y: number, z: number, at: number): MovementState {
  let next = s;
  if (at - s.minuteStart >= 60_000) {
    next = closeMinute(s);
    const skipped = Math.floor((at - s.minuteStart) / 60_000);
    next = { ...next, minuteStart: s.minuteStart + skipped * 60_000, n: 0, sum: 0, sumSq: 0 };
  }
  const m = Math.sqrt(x * x + y * y + z * z);
  return { ...next, n: next.n + 1, sum: next.sum + m, sumSq: next.sumSq + m * m };
}

/** Closes the minute in progress at the end of a session. */
export const finishMovement = (s: MovementState): MovementState => closeMinute(s);

/** "12:04" for under an hour, "1:02:09" after. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}
