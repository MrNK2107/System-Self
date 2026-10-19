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
/** The PRO chart window; free users are served 14 days whatever they ask. */
export const PRO_CHART_DAYS = 90;
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

/** SVG path for a 0-100 series laid out across `width` x `height` (y grows downward). One point draws a dot-length segment. */
export function linePath(values: readonly number[], width: number, height: number): string {
  if (values.length === 0) return "";
  const step = values.length > 1 ? width / (values.length - 1) : 0;
  const y = (v: number) => height - (Math.max(0, Math.min(100, v)) / 100) * height;
  const pts = values.map((v, i) => `${(i * step).toFixed(1)} ${y(v).toFixed(1)}`);
  if (pts.length === 1) pts.push(`${Math.max(1, width).toFixed(1)} ${y(values[0]!).toFixed(1)}`);
  return `M${pts.join(" L")}`;
}

/** Where the rank changed between consecutive days: the marker sits on the first day of the new rank. */
export function rankChanges(items: readonly { rank: string }[]): { index: number; from: string; to: string }[] {
  const out: { index: number; from: string; to: string }[] = [];
  for (let i = 1; i < items.length; i++) {
    if (items[i]!.rank !== items[i - 1]!.rank) out.push({ index: i, from: items[i - 1]!.rank, to: items[i]!.rank });
  }
  return out;
}

/** The score series of one domain (a day missing the domain reads 0). */
export function domainSeries(items: ScoreHistory["items"], domain: string): number[] {
  return items.map((i) => i.scores[domain] ?? 0);
}

/** The freeze card's state: an active freeze shows the PRD line; PRO can start one; the month may already be used. */
export type FreezeView =
  | { kind: "active"; line: string; until: string }
  | { kind: "used"; availableFrom: string }
  | { kind: "available" };

export function freezeView(status: RankFreezeStatus | undefined): FreezeView {
  if (status?.active && status.until) return { kind: "active", line: RANK_FREEZE_ACTIVE_LINE, until: status.until };
  if (status?.usedThisMonth && status.availableFrom) return { kind: "used", availableFrom: status.availableFrom };
  return { kind: "available" };
}
