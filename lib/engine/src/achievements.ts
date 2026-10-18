import { RANKED_DOMAINS, type Rank, type RankedDomain } from "./constants";
import { isShadowResolved, type ShadowState } from "./shadow";

export type AchievementId =
  | "first_log"
  | "streak_7"
  | "streak_30"
  | "beat_shadow"
  | "rank_d"
  | "rank_c"
  | "rank_b"
  | "rank_a"
  | "rank_s"
  | "quest_10"
  | "quest_50"
  | "forbidden_log"
  | "challenge_win"
  | "challenge_5"
  | "domain_80"
  | "domain_100"
  | "all_domains_60"
  | "discipline_master"
  | "seven_days_straight";

export const ACHIEVEMENT_DEFS: Record<AchievementId, { title: string; description: string; icon: string }> = {
  first_log: { title: "FIRST TRANSMISSION", description: "Log your first entry into the system", icon: "zap" },
  streak_7: { title: "7-DAY OPERATIVE", description: "Maintain a 7-day logging streak in any domain", icon: "calendar" },
  streak_30: { title: "MONTH PROTOCOL", description: "Maintain a 30-day logging streak", icon: "award" },
  beat_shadow: { title: "SHADOW SLAYER", description: "Surpass your Shadow Self in all domains", icon: "eye-off" },
  rank_d: { title: "VECTOR CONFIRMED", description: "Reached rank D — awareness acknowledged", icon: "trending-up" },
  rank_c: { title: "CIPHER UNLOCKED", description: "Reached rank C — consistency established", icon: "trending-up" },
  rank_b: { title: "PHANTOM PROTOCOL", description: "Reached rank B — discipline demonstrated", icon: "trending-up" },
  rank_a: { title: "WRAITH TIER", description: "Reached rank A — elite class entry", icon: "trending-up" },
  rank_s: { title: "ORACLE ASCENSION", description: "Reached the apex rank S", icon: "star" },
  quest_10: { title: "FIELD OPERATOR", description: "Complete 10 quests total", icon: "target" },
  quest_50: { title: "SYSTEM OPERATIVE", description: "Complete 50 quests — career operand", icon: "flag" },
  forbidden_log: { title: "CORRUPTED SIGNAL", description: "Transmit a forbidden entry", icon: "alert-triangle" },
  challenge_win: { title: "FIRST BLOOD", description: "Win your first 7-day challenge", icon: "zap" },
  challenge_5: { title: "SERIAL CHALLENGER", description: "Win 5 challenges total", icon: "users" },
  domain_80: { title: "MASTERY INITIATED", description: "Push any domain to 80+", icon: "bar-chart-2" },
  domain_100: { title: "DOMAIN SOVEREIGN", description: "Max out any domain at 100", icon: "maximize" },
  all_domains_60: { title: "BALANCED ENTITY", description: "All 5 domains above 60 simultaneously", icon: "grid" },
  discipline_master: { title: "IRON PROTOCOL", description: "Reach 90+ in DISCIPLINE", icon: "shield" },
  seven_days_straight: { title: "NO GAPS", description: "Log all 5 domains for 7 consecutive days", icon: "lock" },
};

export interface AchievementContext {
  logsCount: number;
  /** Highest current streak across ranked domains. */
  maxStreak: number;
  /** Lowest current streak across ranked domains. */
  minStreak: number;
  completedQuests: number;
  forbiddenLogs: number;
  challengeWins: number;
  scores: Record<RankedDomain, number>;
  shadow: ShadowState | null;
  now: Date;
}

/** Every non-rank achievement whose rule is met and that is not already unlocked. */
export function newAchievements(ctx: AchievementContext, unlocked: ReadonlySet<AchievementId>): AchievementId[] {
  const values = RANKED_DOMAINS.map((d) => ctx.scores[d]);
  const rules: [AchievementId, boolean][] = [
    ["first_log", ctx.logsCount >= 1],
    ["streak_7", ctx.maxStreak >= 7],
    ["streak_30", ctx.maxStreak >= 30],
    ["quest_10", ctx.completedQuests >= 10],
    ["quest_50", ctx.completedQuests >= 50],
    ["forbidden_log", ctx.forbiddenLogs >= 1],
    ["challenge_win", ctx.challengeWins >= 1],
    ["challenge_5", ctx.challengeWins >= 5],
    ["domain_80", values.some((v) => v >= 80)],
    ["domain_100", values.some((v) => v >= 100)],
    ["all_domains_60", values.every((v) => v >= 60)],
    ["discipline_master", ctx.scores.DISCIPLINE >= 90],
    ["beat_shadow", ctx.shadow !== null && ctx.shadow.active && isShadowResolved(ctx.shadow, ctx.scores, ctx.now)],
    ["seven_days_straight", ctx.minStreak >= 7],
  ];
  return rules.filter(([id, met]) => met && !unlocked.has(id)).map(([id]) => id);
}

const RANK_ACHIEVEMENTS: Record<Rank, AchievementId | null> = {
  E: null,
  D: "rank_d",
  C: "rank_c",
  B: "rank_b",
  A: "rank_a",
  S: "rank_s",
};

export function rankAchievement(rank: Rank): AchievementId | null {
  return RANK_ACHIEVEMENTS[rank];
}
