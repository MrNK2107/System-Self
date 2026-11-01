import { addDays } from "./dates";
import {
  CLEAN_DAY_DELTA,
  DAILY_UPKEEP,
  HEADROOM_EXPONENT,
  HEADROOM_FLOOR,
  QUEST_BASE,
  QUEST_COMMITMENT_DELTA,
  RANKED_DOMAINS,
  STREAK_CAP,
  STREAK_STEP,
  type QuestDifficulty,
  type RankedDomain,
} from "./constants";

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
  return Math.min(STREAK_CAP, round2(1.0 + streak * STREAK_STEP));
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Share of a positive gain a domain at `score` still takes: progress is fast early and slow near the top. */
export function headroom(score: number): number {
  const left = Math.min(1, Math.max(0, 1 - score / 100));
  return Math.max(HEADROOM_FLOOR, left ** HEADROOM_EXPONENT);
}

/** The part of a domain's state applyDelta moves; a custom domain has no ranked `domain` key. */
export type StatState = Pick<DomainState, "score" | "streak" | "lastLogDate">;

export function applyDelta<S extends StatState>(
  s: S,
  delta: number,
  o: {
    bonus: boolean;
    activity: boolean;
    date: string;
    /** Scale positive gains by headroom(score). Default true; false only for raw adjustments. */
    headroom?: boolean;
    /** Most this change may add (what is left of today's cap); positive gains are clipped to it. */
    capRemaining?: number;
  },
): { next: S; actualDelta: number } {
  const mult = o.bonus && delta > 0 ? streakMultiplier(s.streak) : 1;
  let raw = delta * mult;
  if (raw > 0 && o.headroom !== false) raw *= headroom(s.score);
  if (raw > 0 && o.capRemaining !== undefined) raw = Math.min(raw, Math.max(0, o.capRemaining));
  raw = round1(raw);
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

/** Score changes for one completed quest: the base to the quest's own domain plus DISCIPLINE for the commitment. */
export function questCompletionChanges(domain: RankedDomain, difficulty: QuestDifficulty): ChangeSpec[] {
  return [
    { domain, delta: QUEST_BASE[difficulty], bonus: true, activity: true },
    { domain: "DISCIPLINE", delta: QUEST_COMMITMENT_DELTA, bonus: false, activity: true },
  ];
}

/** The clean-day DISCIPLINE bonus (every non-bonus daily quest of the day complete). */
export function cleanDayChange(): ChangeSpec {
  return { domain: "DISCIPLINE", delta: CLEAN_DAY_DELTA, bonus: false, activity: false };
}

/** One rollover day of upkeep: every ranked domain fades a little. Not activity. */
export function upkeepChanges(): ChangeSpec[] {
  return RANKED_DOMAINS.map((domain) => ({ domain, delta: -DAILY_UPKEEP, bonus: false, activity: false }));
}
