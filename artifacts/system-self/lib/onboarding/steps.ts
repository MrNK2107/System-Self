// Step logic behind the onboarding screens: what each step needs before CONTINUE unlocks, and the hint shown
// while it is locked. No React Native imports.
import { MIN_GOAL_LENGTH, RANKED_DOMAINS, type RankedDomain } from "./payload";

/** The numbered steps shown in the app bar. Welcome and calibration are not counted. */
export const ONBOARDING_STEPS = ["rate", "objective", "weakness", "identity", "life", "schedule"] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];
export const TOTAL_STEPS = ONBOARDING_STEPS.length;

/** 1-based position of a step, for "Step 2 of 6". */
export const stepNumber = (step: OnboardingStep): number => ONBOARDING_STEPS.indexOf(step) + 1;

/** Self-ratings while the user fills them in: every domain starts unset. */
export type PartialRatings = Partial<Record<RankedDomain, number>>;

const isRating = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 10;

export function ratedCount(ratings: PartialRatings): number {
  return RANKED_DOMAINS.filter((d) => isRating(ratings[d])).length;
}

/** All five ratings, or null while any is still unset. */
export function completeRatings(ratings: PartialRatings): Record<RankedDomain, number> | null {
  const out = {} as Record<RankedDomain, number>;
  for (const d of RANKED_DOMAINS) {
    const v = ratings[d];
    if (!isRating(v)) return null;
    out[d] = v;
  }
  return out;
}

/** The first unset domain after `from` (wrapping round), or null when every domain is rated. */
export function nextUnrated(ratings: PartialRatings, from?: RankedDomain): RankedDomain | null {
  const start = from ? RANKED_DOMAINS.indexOf(from) + 1 : 0;
  for (let i = 0; i < RANKED_DOMAINS.length; i++) {
    const d = RANKED_DOMAINS[(start + i) % RANKED_DOMAINS.length]!;
    if (!isRating(ratings[d])) return d;
  }
  return null;
}

/** Why CONTINUE is locked on the rating step, or null when it is open. */
export function ratingsHint(ratings: PartialRatings): string | null {
  const n = ratedCount(ratings);
  return n === RANKED_DOMAINS.length ? null : `Rate every domain. ${n} of ${RANKED_DOMAINS.length} rated.`;
}

/** Why CONTINUE is locked on the objective step, or null when it is open. */
export function objectiveHint(goal: string): string | null {
  const len = goal.trim().length;
  if (len >= MIN_GOAL_LENGTH) return null;
  return len === 0 ? "Pick an objective or write your own." : `Write at least ${MIN_GOAL_LENGTH} characters.`;
}

/** Why CONTINUE is locked on the weakness step, or null when it is open. */
export function weaknessHint(weakness: RankedDomain | null): string | null {
  return weakness ? null : "Pick the domain that held you back most.";
}

export { isHHMM } from "./payload";

/** Preset times offered by the schedule step's picker sheets (24-hour HH:MM, the stored format). */
export const MORNING_PRESETS = ["05:00", "05:30", "06:00", "06:30", "07:00", "07:30", "08:00", "08:30", "09:00"] as const;
export const NIGHTLY_PRESETS = ["19:30", "20:00", "20:30", "21:00", "21:30", "22:00", "22:30", "23:00"] as const;
