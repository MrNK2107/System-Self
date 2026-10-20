// Today tab: which quest is "next", what it pays, how close its deadline is, and which one contextual card shows.
import { QUEST_COMPLETE_DELTA } from "@workspace/engine";
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
  if (missed && active.some((q) => q.id === missed.id)) return { quest: missed, more: active.length - 1 };
  const sorted = [...active].sort((a, b) => {
    if (!!a.bonus !== !!b.bonus) return a.bonus ? 1 : -1;
    const ta = Date.parse(a.expiresAt);
    const tb = Date.parse(b.expiresAt);
    if (ta !== tb) return (Number.isNaN(ta) ? Infinity : ta) - (Number.isNaN(tb) ? Infinity : tb);
    return 0;
  });
  return { quest: sorted[0]!, more: active.length - 1 };
}

/**
 * What completing the quest pays, as the server applies it (routes/quests.ts: QUEST_COMPLETE_DELTA to DISCIPLINE,
 * before any streak bonus). A bonus quest has no rank effect, so it pays nothing that can be shown.
 */
export function questReward(q: Pick<Quest, "bonus">): { delta: number; domain: Domain } | null {
  if (q.bonus) return null;
  return { delta: QUEST_COMPLETE_DELTA, domain: "DISCIPLINE" };
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
