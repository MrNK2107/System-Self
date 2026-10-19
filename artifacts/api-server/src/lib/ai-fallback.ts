export interface TemplateContext {
  rank: string;
  dayNumber: number;
  shadowGap: number;
  trajectory: "up" | "stable" | "down";
}

type Template = (c: TemplateContext) => string;

const gap = (c: TemplateContext) => Math.abs(c.shadowGap).toFixed(1);
const trend = (c: TemplateContext) =>
  c.trajectory === "up" ? "rising" : c.trajectory === "down" ? "falling" : "flat";

const TEMPLATES: Record<string, Template[]> = {
  morning_briefing: [
    (c) => `Day ${c.dayNumber}. Rank ${c.rank}. Trajectory ${trend(c)}. Open your quests and begin.`,
  ],
  nightly_debrief: [
    (c) =>
      c.trajectory === "up"
        ? `Day ${c.dayNumber} closed at rank ${c.rank}. Trajectory ${trend(c)}. Acceptable.`
        : `Day ${c.dayNumber} closed at rank ${c.rank}. Trajectory ${trend(c)}. Insufficient.`,
  ],
  quest_assignment: [(c) => `New quests are assigned for day ${c.dayNumber}. Complete them before the day closes.`],
  rank_change: [
    (c) =>
      c.trajectory === "up"
        ? `Rank ${c.rank} confirmed. The standard rises with you.`
        : `Rank ${c.rank}. The score moved, and not in your favor.`,
  ],
  shadow_self: [(c) => `Your shadow is active. The gap stands at ${gap(c)} points. It does not skip days.`],
  milestone: [(c) => `Day ${c.dayNumber}. Rank ${c.rank}. A milestone reached. Another follows.`],
  failure_response: [(c) => `Quest missed on day ${c.dayNumber}. The record is updated. Rank ${c.rank} holds for now.`],
  streak_break: [
    (c) => `Streak broken on day ${c.dayNumber}. The gap to your shadow is now ${gap(c)} points. Log again today.`,
  ],
  shadow_confrontation: [
    (c) =>
      c.shadowGap > 0
        ? `You are ${gap(c)} points behind your shadow. It does not tire. You do.`
        : `You lead your shadow by ${gap(c)} points. It accelerates. Do not slow down.`,
  ],
  rival_taunt: [(c) => `Your rival moved on day ${c.dayNumber}. Rank ${c.rank} is not a position you hold by default.`],
  chain_complete: [(c) => `Chain complete. Day ${c.dayNumber}, rank ${c.rank}. The next chain begins now.`],
  domain_milestone: [(c) => `A domain milestone is logged. Rank ${c.rank}. The weakest domain is still waiting.`],
  forbidden_log: [(c) => `Forbidden entry recorded on day ${c.dayNumber}. The gap to your shadow is ${gap(c)} points.`],
  rank_up_prep: [(c) => `Your trajectory is ${trend(c)}. Rank ${c.rank} is within reach.`],
  weekly_debrief: [(c) => `Seven days reviewed at rank ${c.rank}. Trajectory ${trend(c)}. The record stands as logged.`],
};

export function templateSystemMessage(messageType: string, ctx: TemplateContext): string {
  const options = TEMPLATES[messageType] ?? TEMPLATES["morning_briefing"]!;
  return options[ctx.dayNumber % options.length]!(ctx);
}

const DOMAIN_QUESTS: Record<string, { title: string; description: string }> = {
  BODY: { title: "Log your workout", description: "Complete and log any physical activity today." },
  MIND: { title: "Deep work session", description: "Complete one uninterrupted 90-minute focus session." },
  WEALTH: { title: "Review expenses", description: "Categorize all uncategorized expenses from this week." },
  SOCIAL: { title: "Contact someone who matters", description: "Hold one real conversation with a person you have neglected." },
  DISCIPLINE: { title: "Maintain your streak", description: "Log at least one entry today in every domain." },
};
const WEEKLY_QUESTS: Record<string, { title: string; description: string }> = {
  BODY: { title: "Four training sessions", description: "Log four separate workouts before the week closes." },
  MIND: { title: "Finish one deep project block", description: "Spend five hours of focused work on one thing this week." },
  WEALTH: { title: "Weekly money review", description: "Reconcile every expense and set next week's limit." },
  SOCIAL: { title: "Three real conversations", description: "Meet or call three people you have been avoiding." },
  DISCIPLINE: { title: "Log every day", description: "Log at least one entry on each of the next seven days." },
};
const ARC_QUESTS: Record<string, { title: string; description: string }> = {
  BODY: { title: "Twenty-one day training arc", description: "Train at least five days in each of the next three weeks." },
  MIND: { title: "Three week study arc", description: "Complete a daily focus block for twenty-one days." },
  WEALTH: { title: "Three week savings arc", description: "Track every expense and move a fixed amount to savings each week." },
  SOCIAL: { title: "Three week connection arc", description: "Reach out to one person a day for twenty-one days." },
  DISCIPLINE: { title: "Three week consistency arc", description: "Complete one quest every day for twenty-one days." },
};
const DOMAIN_ORDER = ["BODY", "MIND", "WEALTH", "SOCIAL", "DISCIPLINE"];

export interface TemplateQuest {
  title: string;
  description: string;
  domain: string;
  type: "daily" | "weekly" | "arc";
}

/** Template board candidates: 3 dailies (weakest domain first), then one weekly and one arc in the weakest domain. */
/** Home path: BODY template quests become bodyweight home sessions of under 25 minutes. */
const HOME_QUESTS: Record<"daily" | "weekly" | "arc", { title: string; description: string }> = {
  daily: { title: "Home session", description: "Do one bodyweight home session of under 25 minutes, no equipment, and log it." },
  weekly: { title: "Four home sessions", description: "Log four separate bodyweight home sessions before the week closes." },
  arc: { title: "Three week home session arc", description: "Do a bodyweight home session at least four days in each of the next three weeks." },
};

/** During a season every template shrinks: BODY goes home-based, the rest ask for a short version. */
const SEASON_QUESTS: Record<string, { title: string; description: string }> = {
  MIND: { title: "One short focus block", description: "Complete one focused block of 25 minutes and log it." },
  WEALTH: { title: "Five minute money check", description: "Review today's spending in five minutes and log it." },
  SOCIAL: { title: "One short message", description: "Send one real message to a person who matters." },
  DISCIPLINE: { title: "Keep the streak small", description: "Log one entry today. Keep it short." },
};

export function templateQuests(ctx: { weakestDomain: string; homePathActive?: boolean; seasonActive?: boolean }): TemplateQuest[] {
  const first = DOMAIN_QUESTS[ctx.weakestDomain] ? ctx.weakestDomain : "DISCIPLINE";
  const domains = [first, ...DOMAIN_ORDER.filter((d) => d !== first)].slice(0, 3);
  const pick = (domain: string, type: "daily" | "weekly" | "arc", base: { title: string; description: string }) =>
    (ctx.homePathActive || ctx.seasonActive) && domain === "BODY"
      ? HOME_QUESTS[type]
      : ctx.seasonActive && type === "daily" && SEASON_QUESTS[domain]
        ? SEASON_QUESTS[domain]!
        : base;
  return [
    ...domains.map((domain) => ({ ...pick(domain, "daily", DOMAIN_QUESTS[domain]!), domain, type: "daily" as const })),
    { ...pick(first, "weekly", WEEKLY_QUESTS[first]!), domain: first, type: "weekly" as const },
    { ...pick(first, "arc", ARC_QUESTS[first]!), domain: first, type: "arc" as const },
  ];
}
