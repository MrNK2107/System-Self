// Quest list rows: the one meta line, the time left, and the plain-words Shadow line. No React Native imports.
import type { Quest } from "./types";

/** Under this much time left, the due label is shown as urgent. */
export const DUE_URGENT_MS = 3 * 60 * 60 * 1000;

const pad = (n: number) => String(n).padStart(2, "0");

/** Local wall-clock time of the deadline, "21:00"; null for a bad date. */
export function dueClock(expiresAt: string): string | null {
  const t = new Date(expiresAt);
  if (Number.isNaN(t.getTime())) return null;
  return `${pad(t.getHours())}:${pad(t.getMinutes())}`;
}

/** Time left before the deadline: "45m", "2h", "3d" ("due" once passed), urgent under 3 h. Null for a bad date. */
export function dueIn(expiresAt: string, now: Date): { label: string; urgent: boolean } | null {
  const t = new Date(expiresAt).getTime();
  if (Number.isNaN(t)) return null;
  const left = t - now.getTime();
  if (left <= 0) return { label: "due", urgent: true };
  const min = Math.floor(left / 60000);
  const label = min < 60 ? `${Math.max(1, min)}m` : min < 48 * 60 ? `${Math.floor(min / 60)}h` : `${Math.floor(min / 1440)}d`;
  return { label, urgent: left < DUE_URGENT_MS };
}

const TYPE_WORD: Record<Quest["type"], string> = { daily: "Daily", weekly: "Weekly", arc: "Arc" };

/**
 * One meta line under the quest title, e.g. "BODY · slot 18:00–19:00 · due 21:00".
 * Dailies drop the type word (the Today list is all dailies); bonus quests say they carry no rank effect.
 */
export function questMeta(q: Pick<Quest, "type" | "domain" | "status" | "expiresAt" | "bonus" | "chainStep" | "chainTotal" | "slotStart" | "slotEnd">): string {
  const parts: string[] = [];
  if (q.type !== "daily") parts.push(TYPE_WORD[q.type]);
  parts.push(q.domain);
  if (q.bonus) parts.push("bonus, no rank effect");
  if (q.chainStep != null && q.chainTotal != null) parts.push(`step ${q.chainStep + 1} of ${q.chainTotal}`);
  if (q.status === "active") {
    if (q.slotStart && q.slotEnd) parts.push(`slot ${q.slotStart}–${q.slotEnd}`);
    const clock = dueClock(q.expiresAt);
    if (clock && q.type === "daily") parts.push(`due ${clock}`);
  } else {
    parts.push(q.status === "complete" ? "done" : q.status === "refused" ? "refused" : "missed");
  }
  return parts.join(" · ");
}

/**
 * The Shadow's lead in plain words, or null when there is none (a gap of 0 is not shown).
 * Over 10 points the board leans toward DISCIPLINE; over 20 quests are escalated (server rules, described here).
 */
export function shadowGapLine(gap: number): string | null {
  if (!Number.isFinite(gap) || gap <= 0) return null;
  const lead = `Your Shadow is ${gap.toFixed(1)} points ahead of you. Finish quests to close the gap.`;
  if (gap > 20) return `${lead} Quests are escalated.`;
  if (gap > 10) return `${lead} Today's board leans toward DISCIPLINE.`;
  return lead;
}
