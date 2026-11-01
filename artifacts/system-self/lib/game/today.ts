// Today tab: which quest is "next", what it pays, how close its deadline is, and which one contextual card shows.
import { QUEST_BASE, headroom } from "@workspace/engine";
import type { QuestTarget } from "@workspace/engine";
import type { Domain, Quest } from "./types";

/** Under this many hours left, the deadline line turns to the warning colour. */
export const URGENT_HOURS = 3;

/**
 * The one quest Today puts first, and how many other active quests wait on the Quests tab.
 * A missed slot outranks everything (it is already late); then ranked quests before bonus ones, earliest deadline first.
 */
export function pickNextQuest(quests: readonly Quest[], missed: Quest | null): { quest: Quest | null; more: number } {
  const active = quests.filter((q) => q.status === "active");
  if (active.length === 0) return { quest: null, more: 0 };
  // "N more today" matches the Quests tab's Today segment: dailies and bonus quests, not weeklies or arcs.
  const moreToday = (picked: Quest) => active.filter((q) => q.id !== picked.id && (q.bonus || q.type === "daily")).length;
  if (missed && active.some((q) => q.id === missed.id)) return { quest: missed, more: moreToday(missed) };
  const sorted = [...active].sort((a, b) => {
    if (!!a.bonus !== !!b.bonus) return a.bonus ? 1 : -1;
    const ta = Date.parse(a.expiresAt);
    const tb = Date.parse(b.expiresAt);
    if (ta !== tb) return (Number.isNaN(ta) ? Infinity : ta) - (Number.isNaN(tb) ? Infinity : tb);
    return 0;
  });
  return { quest: sorted[0]!, more: moreToday(sorted[0]!) };
}

/**
 * What completing the quest pays, as the server applies it (routes/quests.ts): the difficulty's base to the quest's own
 * domain, shrunk by the headroom left at the user's current `score` in that domain (before any streak bonus or daily
 * cap). Without a score the raw base is shown. A bonus quest has no rank effect, so it pays nothing that can be shown.
 */
export function questReward(q: Pick<Quest, "bonus" | "domain" | "difficulty">, score?: number): { delta: number; domain: Domain } | null {
  if (q.bonus) return null;
  const base = QUEST_BASE[q.difficulty ?? "normal"];
  const delta = Math.round(base * (score === undefined ? 1 : headroom(score)) * 10) / 10;
  return { delta, domain: q.domain };
}

const UNIT: Record<QuestTarget["unit"], string> = { min: "MIN", steps: "STEPS", INR: "", times: "×", days: "DAY" };

/** The target alone, e.g. "4 × 30 MIN", "8,000 STEPS", "₹500", "3×", "NO SPEND". */
export function targetText(t: QuestTarget): string {
  const n = t.value.toLocaleString("en-IN");
  let what: string;
  if (t.unit === "INR") what = t.value > 0 ? `₹${n}` : t.kind === "money_save" ? "SAVE" : "TRACK SPENDING";
  else if (t.unit === "times") what = `${n}×`;
  else if (t.kind === "no_spend") what = "NO SPEND";
  else what = `${n} ${UNIT[t.unit]}`;
  return t.sessions ? `${t.sessions} × ${what}` : what;
}

/** Difficulty and target as one caps line, e.g. "HARD · 4 × 30 MIN", "EASY · 8,000 STEPS", "NORMAL". */
export function questTargetLabel(q: Pick<Quest, "difficulty" | "target">): string {
  const parts = [(q.difficulty ?? "normal").toUpperCase()];
  if (q.target) parts.push(targetText(q.target));
  return parts.join(" · ");
}

/** "+3" for whole numbers, "+2.5" otherwise. */
export const formatReward = (delta: number): string => `+${Number.isInteger(delta) ? delta : delta.toFixed(1)}`;

function clockTime(d: Date, tz?: string | null): string {
  if (tz) {
    try {
      return new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
    } catch {
      // unknown zone: device clock below
    }
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "Due 21:00 · 2h left"; urgent under URGENT_HOURS. Days for long quests, minutes in the last hour. */
export function deadlineLine(expiresAt: string, now: Date, tz?: string | null): { text: string; urgent: boolean } | null {
  const end = Date.parse(expiresAt);
  if (Number.isNaN(end)) return null;
  const ms = end - now.getTime();
  if (ms <= 0) return { text: "Deadline passed", urgent: true };
  const minutes = Math.floor(ms / 60_000);
  const hours = Math.floor(minutes / 60);
  const left = hours >= 24 ? `${Math.floor(hours / 24)}d left` : hours >= 1 ? `${hours}h left` : `${Math.max(1, minutes)}m left`;
  return { text: `Due ${clockTime(new Date(end), tz)} · ${left}`, urgent: ms < URGENT_HOURS * 3_600_000 };
}

export type ContextCard = "shadow" | "comeback" | "duo" | "floor" | null;

/** Today shows at most one contextual card under the next quest: shadow > comeback > duo > floor. */
export function pickContextCard(s: { shadow: boolean; comeback: boolean; duo: boolean; floor: boolean }): ContextCard {
  if (s.shadow) return "shadow";
  if (s.comeback) return "comeback";
  if (s.duo) return "duo";
  if (s.floor) return "floor";
  return null;
}

/**
 * The reward in one sentence, the same on the Today card and the quest sheet. Completion always pays DISCIPLINE
 * (whatever the quest's domain) and the streak multiplier scales it, so the base is stated as a base; the
 * [ QUEST COMPLETE ] window then reports the exact amount applied.
 */
export function rewardStatement(q: Pick<Quest, "bonus" | "domain" | "difficulty">, score?: number): string {
  const r = questReward(q, score);
  return r ? `${formatReward(r.delta)} ${r.domain} base. Your streak adds more.` : "No rank effect. Bonus quests don't score.";
}
