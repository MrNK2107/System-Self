// Score history and Rank Freeze (GET /api/history/scores, GET /api/history/quests, GET/POST /api/rank-freeze).
// Plain module (no React Native imports). The history carries domain scores and rank only: the hidden score never
// reaches the device.
import {
  QuestTrendSchema,
  RANK_FREEZE_ACTIVE_LINE,
  RankFreezeResponseSchema,
  RankFreezeStatusSchema,
  ScoreHistorySchema,
  type QuestTrend,
  type RankFreezeResponse,
  type RankFreezeStatus,
  type ScoreHistory,
} from "@workspace/contracts";
import type { ApiClient } from "../api/client";

export { isProRequired } from "../api/pro";
export { RANK_FREEZE_ACTIVE_LINE };

export const REASON_MAX = 120;
/** The PRO chart window ("Full history. 365 days."); free users are served 14 days whatever they ask. */
export const PRO_CHART_DAYS = 365;
export const FREE_CHART_DAYS = 14;

export const scoreHistoryKey = (userId: string | null, days: number) => ["history-scores", userId, days] as const;
export const questTrendKey = (userId: string | null, days: number) => ["history-quests", userId, days] as const;
export const rankFreezeKey = (userId: string | null) => ["rank-freeze", userId] as const;

export function fetchScoreHistory(api: ApiClient, days: number): Promise<ScoreHistory> {
  return api.request("GET", `/api/history/scores?days=${days}`, { schema: ScoreHistorySchema });
}

export function fetchQuestTrend(api: ApiClient, days: number): Promise<QuestTrend> {
  return api.request("GET", `/api/history/quests?days=${days}`, { schema: QuestTrendSchema });
}

export function fetchRankFreeze(api: ApiClient): Promise<RankFreezeStatus> {
  return api.request("GET", "/api/rank-freeze", { schema: RankFreezeStatusSchema });
}

/** One idempotency key per confirmed attempt, so a retry of the same tap replays instead of burning the month. */
export function startRankFreeze(api: ApiClient, reason: string, idempotencyKey: string): Promise<RankFreezeResponse> {
  return api.request("POST", "/api/rank-freeze", { body: { reason: reason.trim() }, idempotencyKey, schema: RankFreezeResponseSchema });
}

/** The reason box against the server's rule (1 to 120 characters once trimmed); null when fine. */
export function checkFreezeReason(text: string): string | null {
  const t = text.trim();
  if (t.length < 1) return "Give a reason.";
  if (t.length > REASON_MAX) return `The reason is at most ${REASON_MAX} characters.`;
  return null;
}

/** Where the rank changed between consecutive days: the marker sits on the first day of the new rank. */
export function rankChanges(items: readonly { rank: string }[]): { index: number; from: string; to: string }[] {
  const out: { index: number; from: string; to: string }[] = [];
  for (let i = 1; i < items.length; i++) {
    if (items[i]!.rank !== items[i - 1]!.rank) out.push({ index: i, from: items[i - 1]!.rank, to: items[i]!.rank });
  }
  return out;
}

/** Whole days from `from` to `date` (both `YYYY-MM-DD`, UTC arithmetic so DST never skews it). */
export function dayOffset(from: string, date: string): number {
  const ms = (d: string) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
  return Math.round((ms(date) - ms(from)) / 86_400_000);
}

const xFor = (offset: number, span: number, width: number) => (span > 1 ? (offset * width) / (span - 1) : 0);

/**
 * SVG path for dated 0-100 points over a window of `span` days starting at `from`: x is the day offset, so a day with
 * no snapshot is a gap (the stroke breaks) instead of the line joining its neighbours.
 */
export function seriesPath(points: readonly { date: string; value: number }[], from: string, span: number, width: number, height: number): string {
  const y = (v: number) => height - (Math.max(0, Math.min(100, v)) / 100) * height;
  const parts: string[] = [];
  let prev = Number.NEGATIVE_INFINITY;
  for (const p of points) {
    const o = dayOffset(from, p.date);
    const pt = `${xFor(o, span, width).toFixed(1)} ${y(p.value).toFixed(1)}`;
    parts.push(o - prev === 1 ? `L${pt}` : `M${pt}`);
    prev = o;
  }
  // A lone point (a break on both sides) still draws as a zero-length segment so it is visible.
  return parts.map((part, i) => (part.startsWith("M") && (i === parts.length - 1 || parts[i + 1]!.startsWith("M")) ? `${part} L${part.slice(1)}` : part)).join(" ");
}

/** One bar per day with resolved quests: height is the completion rate, placed by day offset. */
export function barRects(items: readonly { date: string; completed: number; resolved: number }[], from: string, span: number, width: number, height: number) {
  const step = span > 1 ? width / (span - 1) : width;
  const barW = Math.max(2, Math.min(10, step * 0.6));
  return items.map((i) => {
    const h = i.resolved > 0 ? (i.completed / i.resolved) * height : 0;
    return { x: xFor(dayOffset(from, i.date), span, width) - barW / 2, y: height - h, width: barW, height: h };
  });
}

/** The dated score series of one domain (a day missing the domain reads 0). */
export function domainSeries(items: ScoreHistory["items"], domain: string): { date: string; value: number }[] {
  return items.map((i) => ({ date: i.date, value: i.scores[domain] ?? 0 }));
}

/** The freeze card's state: an active freeze shows the PRD line; PRO can start one; the month may already be used. */
export type FreezeView =
  | { kind: "active"; line: string; until: string }
  | { kind: "wait"; availableFrom: string }
  | { kind: "available" };

/** Rank Freeze pitch: the same words for free and PRO users (a freeze pauses promotion too). */
export const FREEZE_PITCH = "Pause decay, demotion and promotion for 7 days, once a month.";
export const FREEZE_PITCH_PRO = `${FREEZE_PITCH} The rank holds still. You do not.`;

export type FreezeCardMode = "active" | "locked" | "wait" | "available";

/** What the Rank Freeze card shows: an active freeze always (even once PRO has lapsed), else the lock for free users. */
export function freezeCardMode(pro: boolean, view: FreezeView): FreezeCardMode {
  if (view.kind === "active") return "active";
  if (!pro) return "locked";
  return view.kind;
}

export function freezeView(status: RankFreezeStatus | undefined): FreezeView {
  if (status?.active && status.until) return { kind: "active", line: RANK_FREEZE_ACTIVE_LINE, until: status.until };
  // A non-null availableFrom is the earliest day a freeze can start (month used, or the 7-day gap after the last one).
  if (status?.availableFrom) return { kind: "wait", availableFrom: status.availableFrom };
  return { kind: "available" };
}
