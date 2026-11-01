export const RANKED_DOMAINS = ["BODY", "MIND", "WEALTH", "SOCIAL", "DISCIPLINE"] as const;
export type RankedDomain = (typeof RANKED_DOMAINS)[number];

export const RANKS = ["E", "D", "C", "B", "A", "S"] as const;
export type Rank = (typeof RANKS)[number];

export type QuestType = "daily" | "weekly" | "arc";

export const BASE_LOG_DELTAS: Record<RankedDomain, number> = {
  BODY: 2.5,
  MIND: 2.5,
  WEALTH: 2.0,
  SOCIAL: 2.0,
  DISCIPLINE: 3.0,
};

export const FORBIDDEN_DOMAIN_DELTA = 5;
export const FORBIDDEN_DISCIPLINE_DELTA = -2;

// Pacing (spec docs/superpowers/specs/2026-11-01-proof-and-scoring-design.md, section 6). Tuned with the
// 180-day simulation in pacing.test.ts: change these only together with that test.
export type QuestDifficulty = "easy" | "normal" | "hard";
/** Base gain of a completed quest, credited to the quest's own domain. */
export const QUEST_BASE: Record<QuestDifficulty, number> = { easy: 2, normal: 3.5, hard: 5.5 };
/** DISCIPLINE for keeping any commitment (every completed quest). */
export const QUEST_COMMITMENT_DELTA = 0.8;
/** DISCIPLINE when every non-bonus daily quest of the day is complete. */
export const CLEAN_DAY_DELTA = 1.2;
/** Positive gain one domain can take in one local day (logs, quests, gym, clean day). */
export const DAILY_GAIN_CAP = 4;
/** Of that, what unverified self-reported logs can add per domain per day. */
export const LOG_DAILY_GAIN_CAP = 0.5;
/** Every domain loses this much per day: real skills fade without upkeep. (Scores keep one decimal: no 0.15.) */
export const DAILY_UPKEEP = 0.1;
/** Gains shrink with the headroom left: max(FLOOR, (1 - score/100)^EXPONENT). */
export const HEADROOM_EXPONENT = 1.8;
export const HEADROOM_FLOOR = 0.02;
export const STREAK_STEP = 0.05;
export const STREAK_CAP = 1.5;

/** Penalties as positive numbers, subtracted from DISCIPLINE. A lapse costs more than one day's win. */
export const QUEST_FAIL_PENALTY: Record<QuestType, number> = {
  daily: 1.5,
  weekly: 4,
  arc: 8,
};
