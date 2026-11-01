import type { QuestDifficulty, QuestType } from "./constants";

export type QuestTargetKind = "workout" | "steps" | "study" | "money_save" | "money_cap" | "no_spend" | "social_meet";

/** What a quest measures. For weekly and arc quests `sessions` is how many qualifying sessions are needed. */
export interface QuestTarget {
  kind: QuestTargetKind;
  metric: "active_minutes" | "steps" | "minutes" | "amount" | "count" | "days";
  value: number;
  unit: "min" | "steps" | "INR" | "times" | "days";
  sessions?: number;
}

export interface QuestSpec {
  difficulty: QuestDifficulty;
  target: QuestTarget | null;
}

const WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, ninety: 90,
};
const NUM = `(\\d[\\d,]*(?:\\.\\d+)?|${Object.keys(WORDS).join("|")})`;
const toNum = (s: string): number => WORDS[s.toLowerCase()] ?? Number(s.replace(/,/g, ""));
const find = (text: string, re: RegExp): number | null => {
  const m = text.match(re);
  return m ? toNum(m[1]!) : null;
};

const minutesIn = (t: string): number | null => {
  const min = find(t, new RegExp(`${NUM}[\\s-]*(?:min|minute)`, "i"));
  if (min !== null) return min;
  const hrs = find(t, new RegExp(`${NUM}[\\s-]*hours?`, "i"));
  return hrs !== null ? Math.round(hrs * 60) : null;
};
const amountIn = (t: string): number | null => find(t, /(?:₹|rs\.?|inr)\s*(\d[\d,]*)/i);
const countIn = (t: string, nouns: string): number | null => find(t, new RegExp(`${NUM}\\s+(?:separate\\s+|real\\s+)?(?:${nouns})`, "i"));

/**
 * Difficulty and measurable target read from a quest's text. Used for every created quest (AI, template, chain),
 * so it must never throw: unknown domains and number-free text fall back to the domain default.
 */
export function inferQuestSpec(q: { domain: string; type: QuestType; title: string; description: string }): QuestSpec {
  const t = `${q.title}. ${q.description}`;
  const arc = q.type === "arc";
  const pick = (easy: boolean, hard: boolean): QuestDifficulty => (arc || hard ? "hard" : easy ? "easy" : "normal");

  switch (q.domain) {
    case "BODY": {
      const steps = find(t, new RegExp(`${NUM}\\s*steps`, "i"));
      if (steps !== null) {
        return { difficulty: pick(steps < 5000, steps >= 12000), target: { kind: "steps", metric: "steps", value: steps, unit: "steps" } };
      }
      const minutes = minutesIn(t) ?? 30;
      const sessions = q.type === "daily" ? null : countIn(t, "sessions|workouts|days|training sessions|home sessions");
      const target: QuestTarget = { kind: "workout", metric: "active_minutes", value: minutes, unit: "min" };
      if (sessions !== null) target.sessions = sessions;
      return { difficulty: pick(minutes <= 25, minutes >= 60 || (sessions ?? 0) >= 5), target };
    }
    case "MIND": {
      const minutes = minutesIn(t) ?? 45;
      return {
        difficulty: pick(minutes <= 25, minutes >= 90),
        target: { kind: "study", metric: "minutes", value: minutes, unit: "min" },
      };
    }
    case "WEALTH": {
      const amount = amountIn(t) ?? 0;
      if (/no[\s-]?spend|spend nothing/i.test(t)) {
        return { difficulty: pick(false, false), target: { kind: "no_spend", metric: "days", value: 1, unit: "days" } };
      }
      if (/sav/i.test(t)) {
        return { difficulty: pick(false, false), target: { kind: "money_save", metric: "amount", value: amount, unit: "INR" } };
      }
      return { difficulty: pick(false, false), target: { kind: "money_cap", metric: "amount", value: amount, unit: "INR" } };
    }
    case "SOCIAL": {
      const count = countIn(t, "people|persons|conversations|calls|friends|times") ?? 1;
      return {
        difficulty: pick(false, count >= 3),
        target: { kind: "social_meet", metric: "count", value: count, unit: "times" },
      };
    }
    default:
      return { difficulty: pick(false, false), target: null };
  }
}
