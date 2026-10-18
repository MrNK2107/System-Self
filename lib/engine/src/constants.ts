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
export const QUEST_COMPLETE_DELTA = 3;

/** Penalties as positive numbers, subtracted from DISCIPLINE. */
export const QUEST_FAIL_PENALTY: Record<QuestType, number> = {
  daily: 0.8,
  weekly: 2.0,
  arc: 5.0,
};
