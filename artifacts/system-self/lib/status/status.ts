// Status screen logic: who the player is right now (rank line, title, week change per domain) and the honesty
// guards for the recap. Plain module (no React Native imports). The hidden score never reaches the device, so the
// rank line is built from the rank and the server's tierProgress only.
import type { ScoreHistory } from "@workspace/contracts";
import { dayOffset } from "../history/history";

export type Rank = "E" | "D" | "C" | "B" | "A" | "S";

const NEXT: Record<Rank, Rank | null> = { E: "D", D: "C", C: "B", B: "A", A: "S", S: null };

/** Days the hidden score must sit above the next rank's line before promotion (engine PROMOTION_WINDOW). */
export const PROMOTION_DAYS = 14;

/** A recap reviews a full week: the first one is ready once seven days have closed. */
export const RECAP_FIRST_DAY = 8;

export function nextRank(rank: string): Rank | null {
  return (NEXT as Record<string, Rank | null>)[rank] ?? null;
}

export interface RankLine {
  /** 0-100, clamped. */
  progress: number;
  next: Rank | null;
  /** Under the progress line, e.g. "42% of the way to D". */
  progressLine: string;
  /** How promotion actually happens, so a full bar is never read as a promise. */
  promotionLine: string | null;
}

export function rankLine(rank: string, tierProgress: number): RankLine {
  const progress = Math.round(Math.max(0, Math.min(100, Number.isFinite(tierProgress) ? tierProgress : 0)));
  const next = nextRank(rank);
  if (!next) return { progress: 100, next: null, progressLine: "Highest rank.", promotionLine: null };
  return {
    progress,
    next,
    progressLine: `${progress}% of the way to ${next}`,
    promotionLine: `Promotion: ${PROMOTION_DAYS} days in a row above the ${next} line.`,
  };
}

/**
 * Score change over the last seven days: today's live score minus the snapshot from seven days before the history's
 * last day. Null when the history does not reach back that far (a week that has not happened has no change).
 */
export function weekChange(history: Pick<ScoreHistory, "to" | "items"> | undefined, domain: string, current: number): number | null {
  if (!history || history.items.length === 0) return null;
  const ref = history.items.find((i) => dayOffset(i.date, history.to) === 7);
  if (!ref) return null;
  const before = ref.scores[domain];
  if (typeof before !== "number") return null;
  return Math.round((current - before) * 10) / 10;
}

/** "+1.4", "-0.3" (true minus sign), "0.0". */
export function formatChange(n: number): string {
  if (n > 0) return `+${n.toFixed(1)}`;
  if (n < 0) return `−${Math.abs(n).toFixed(1)}`;
  return "0.0";
}

export type Tone = "up" | "down" | "flat";
export function changeTone(n: number | null): Tone {
  if (n === null || n === 0) return "flat";
  return n > 0 ? "up" : "down";
}

/** The newest earned title: the latest milestone title, else the latest achievement title; null when none. */
export function latestTitle(
  milestones: readonly { title: string; unlockedAt: string | null }[],
  achievements: readonly { id: string; unlockedAt: string | null }[],
  achievementTitle: (id: string) => string | undefined,
): string | null {
  const newest = <T extends { unlockedAt: string | null }>(xs: readonly T[]): T | null =>
    xs
      .filter((x) => x.unlockedAt !== null)
      .reduce<T | null>((best, x) => (!best || Date.parse(x.unlockedAt!) > Date.parse(best.unlockedAt!) ? x : best), null);
  const m = newest(milestones);
  if (m?.title) return m.title;
  const a = newest(achievements);
  return a ? achievementTitle(a.id) ?? null : null;
}

/** The weekly recap only reviews a week once one has passed. */
export function recapReady(dayNumber: number): boolean {
  return dayNumber >= RECAP_FIRST_DAY;
}

/** The line a recap shows before its first week closes. */
export const RECAP_NOT_READY_LINE = "First recap after day 7.";

/** Logs grouped by local day, newest day first, newest entry first within a day. */
export function groupByDay<T extends { timestamp: string }>(logs: readonly T[], dayKey: (iso: string) => string): { day: string; items: T[] }[] {
  const sorted = [...logs].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
  const out: { day: string; items: T[] }[] = [];
  for (const l of sorted) {
    const day = dayKey(l.timestamp);
    const last = out[out.length - 1];
    if (last && last.day === day) last.items.push(l);
    else out.push({ day, items: [l] });
  }
  return out;
}
