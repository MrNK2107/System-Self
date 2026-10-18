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
};

export function templateSystemMessage(messageType: string, ctx: TemplateContext): string {
  const options = TEMPLATES[messageType] ?? TEMPLATES["morning_briefing"]!;
  return options[ctx.dayNumber % options.length]!(ctx);
}

const DOMAIN_QUESTS: Record<string, { title: string; description: string }> = {
  BODY: { title: "Log your workout", description: "Complete and log any physical activity today." },
  MIND: { title: "Deep work session", description: "Complete one uninterrupted 90-minute focus session." },
  WEALTH: { title: "Review expenses", description: "Categorize all uncategorized expenses from this week." },
  DISCIPLINE: { title: "Maintain your streak", description: "Log at least one entry today in every domain." },
};
const DOMAIN_ORDER = ["BODY", "MIND", "WEALTH", "DISCIPLINE"];

export function templateQuests(ctx: { weakestDomain: string }): {
  title: string;
  description: string;
  domain: string;
  type: "daily";
}[] {
  const first = DOMAIN_QUESTS[ctx.weakestDomain] ? ctx.weakestDomain : "DISCIPLINE";
  const domains = [first, ...DOMAIN_ORDER.filter((d) => d !== first)].slice(0, 3);
  return domains.map((domain) => ({ ...DOMAIN_QUESTS[domain]!, domain, type: "daily" as const }));
}
