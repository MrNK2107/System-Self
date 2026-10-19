import { addDays } from "./dates";
import type { RankedDomain } from "./constants";

export interface DomainState {
  domain: RankedDomain;
  score: number;
  streak: number;
  lastLogDate: string | null;
}

export interface ChangeSpec {
  domain: RankedDomain;
  delta: number;
  bonus: boolean;
  activity: boolean;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function streakMultiplier(streak: number): number {
  return Math.min(2.0, 1.0 + streak * 0.1);
}

/** The part of a domain's state applyDelta moves; a custom domain has no ranked `domain` key. */
export type StatState = Pick<DomainState, "score" | "streak" | "lastLogDate">;

export function applyDelta<S extends StatState>(
  s: S,
  delta: number,
  o: { bonus: boolean; activity: boolean; date: string },
): { next: S; actualDelta: number } {
  const mult = o.bonus && delta > 0 ? streakMultiplier(s.streak) : 1;
  const raw = round1(delta * mult);
  const score = round1(Math.min(100, Math.max(0, s.score + raw)));
  const actualDelta = round1(score - s.score);

  let { streak, lastLogDate } = s;
  // Same local day, or an earlier date than the last activity (e.g. after a timezone change): unchanged.
  if (o.activity && (lastLogDate === null || lastLogDate < o.date)) {
    streak = lastLogDate !== null && lastLogDate === addDays(o.date, -1) ? streak + 1 : 1;
    lastLogDate = o.date;
  }
  return { next: { ...s, score, streak, lastLogDate }, actualDelta };
}

export function streakBreaks(
  states: DomainState[],
  date: string,
): { broken: RankedDomain[]; penalty: number } {
  const broken = states
    .filter((s) => s.streak > 0 && (s.lastLogDate === null || s.lastLogDate < date))
    .map((s) => s.domain);
  return { broken, penalty: Math.min(6, 2 * broken.length) };
}

export function decayPerDomain(consecutiveInactiveDays: number): number {
  if (consecutiveInactiveDays >= 5) return 0.6;
  if (consecutiveInactiveDays >= 2) return 0.3;
  return 0;
}

export function refusalOutcome(refusalsAlreadyThisWeek: number): { allowed: boolean; penalty: number } {
  if (refusalsAlreadyThisWeek <= 0) return { allowed: true, penalty: 0 };
  if (refusalsAlreadyThisWeek === 1) return { allowed: true, penalty: 1.5 };
  return { allowed: false, penalty: 0 };
}
