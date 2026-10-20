// Rank-up prep: when the app may tell the user they are close to promotion, and what it asks of them.
// Honest status: never on day 1. Prep shows only after a full week on record AND 75% through the rank band.
// Shared by the Quests tab and the Stats screen. No React Native imports.
import type { Domain, Rank } from "./types";

/** Whole days since onboarding before prep may show (day 1 is the onboarding day, so day 8 is the first). */
export const RANK_UP_PREP_MIN_DAYS = 7;
/** Progress through the current rank band (0-100, server `tierProgress`) before prep may show. */
export const RANK_UP_PREP_MIN_PROGRESS = 75;

const NEXT_RANK: Record<Rank, Rank | null> = { E: "D", D: "C", C: "B", B: "A", A: "S", S: null };

/** The rank above `rank`, or null at S (or for an unknown value). */
export function nextRankOf(rank: Rank | string | null | undefined): Rank | null {
  if (!rank || !(rank in NEXT_RANK)) return null;
  return NEXT_RANK[rank as Rank];
}

export interface RankUpPrepInput {
  rank: Rank | string | null | undefined;
  /** 0-100: how far the hidden score is through the current rank band (server-computed). */
  tierProgress: number | null | undefined;
  /** The profile's day counter: 1 on the onboarding day. */
  dayNumber: number | null | undefined;
}

/**
 * True only when the claim "near the promotion threshold" is backed by the data: a rank above exists, at least
 * RANK_UP_PREP_MIN_DAYS whole days have passed since onboarding, and progress is at least RANK_UP_PREP_MIN_PROGRESS.
 */
export function shouldShowRankUpPrep({ rank, tierProgress, dayNumber }: RankUpPrepInput): boolean {
  if (nextRankOf(rank) === null) return false;
  if (typeof dayNumber !== "number" || !Number.isFinite(dayNumber)) return false;
  if (typeof tierProgress !== "number" || !Number.isFinite(tierProgress)) return false;
  return dayNumber - 1 >= RANK_UP_PREP_MIN_DAYS && tierProgress >= RANK_UP_PREP_MIN_PROGRESS;
}

export interface RankUpPrepItem {
  title: string;
  description: string;
  domain: Domain;
}

/** What each promotion asks for, keyed by the rank being promoted to. Display only; the server decides rank. */
export const RANK_UP_PREP_QUESTS: Record<Exclude<Rank, "E">, RankUpPrepItem[]> = {
  D: [
    { title: "Log 7 days in a row", description: "Log at least one domain a day for 7 days without a miss.", domain: "DISCIPLINE" },
    { title: "Awareness audit", description: "Log one detailed entry in all 5 domains this week.", domain: "MIND" },
  ],
  C: [
    { title: "3 days of all domains", description: "Log all 5 domains for 3 days in a row.", domain: "DISCIPLINE" },
    { title: "Weakest domain to 60+", description: "Your weakest domain score must clear 60. Any method counts.", domain: "BODY" },
  ],
  B: [
    { title: "Complete 3 quests this week", description: "Mark 3 quests done before the week ends. Attempts do not count.", domain: "DISCIPLINE" },
    { title: "Shadow gap under 5", description: "Bring your Shadow's lead over you under 5 points.", domain: "DISCIPLINE" },
  ],
  A: [
    { title: "All domains above 70", description: "No domain below 70.", domain: "MIND" },
    { title: "10-day unbroken streak", description: "Log at least 2 domains a day for 10 days in a row.", domain: "DISCIPLINE" },
  ],
  S: [
    { title: "DISCIPLINE past 90", description: "S rank requires command of yourself.", domain: "DISCIPLINE" },
    { title: "All domains above 85", description: "Every domain at 85 or higher.", domain: "BODY" },
  ],
};

/** The prep list for the promotion above `rank` (empty at S). */
export function rankUpPrepItems(rank: Rank | string | null | undefined): RankUpPrepItem[] {
  const next = nextRankOf(rank);
  return next && next !== "E" ? RANK_UP_PREP_QUESTS[next] : [];
}
