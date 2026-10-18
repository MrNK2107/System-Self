// Network logic for SYSTEM messages, the nightly debrief, the weekly recap and the completion summary.
// No React Native imports (used by the smoke script under plain node).
import {
  CompletionSummarySchema,
  DebriefTodayResponseSchema,
  MessageResponseSchema,
  WeeklyDebriefResponseSchema,
  WeeklyRecapSchema,
  type MessageType,
} from "@workspace/contracts";
import type { z } from "zod";
import type { ApiClient } from "../api/client";
import type { Outbox } from "../api/outbox";
import { afterOutbox, type MutationResult } from "./actions";
import type { DebriefData } from "./types";

export type { MessageType };
export type DebriefToday = z.infer<typeof DebriefTodayResponseSchema>;
export type ServerDebrief = Extract<DebriefToday, { available: true }>["debrief"];
export type WeeklyRecap = z.infer<typeof WeeklyRecapSchema>;
export type WeeklyDebrief = z.infer<typeof WeeklyDebriefResponseSchema>;
export type CompletionSummary = z.infer<typeof CompletionSummarySchema>;

const FALLBACKS: Record<MessageType, string> = {
  morning_briefing: "A new day is open. The quests on your board are waiting. Your scores are being watched.",
  nightly_debrief: "The day is closed. The record stands as logged. Verdict: Insufficient until proven otherwise.",
  quest_assignment: "New quests assigned. Check your board.",
  rank_change: "Rank updated. Noted.",
  shadow_self: "Your Shadow Self has been initialized. It is already ahead of you. This is information.",
  milestone: "Progress logged. Continue.",
  failure_response: "Quest failure logged. The timestamp is permanent. The gap just widened.",
  streak_break: "Streak data erased. The gap with your Shadow Self just widened. This is recorded.",
  shadow_confrontation: "You are still behind. That gap does not close on its own. Log something.",
  rival_taunt: "You think you have time. Your scores say otherwise.",
  chain_complete: "Arc complete. The system has noted your consistency. Barely.",
  domain_milestone: "Threshold reached. This is not praise. It is an observation. Continue.",
  forbidden_log: "Transmission received. The system acknowledges the entry. There will be consequences.",
  rank_up_prep: "You are close to promotion. The gap between your current state and the next rank is thin. Do not celebrate yet.",
  weekly_debrief: "The week is closed. The record stands as logged. Consistency is the only variable you control.",
};

export function fallbackMessage(type: MessageType): string {
  return FALLBACKS[type];
}

/**
 * POST /api/messages. The server builds the whole context; only the type (and an optional short note) is sent.
 * Returns null on any failure (offline, 429 message_limit, 409 debrief_unavailable, ...).
 */
export async function tryFetchMessage(
  api: ApiClient,
  type: MessageType,
  opts: { extraContext?: string } = {},
): Promise<string | null> {
  try {
    const res = await api.request("POST", "/api/messages", {
      body: { type, ...(opts.extraContext ? { extraContext: opts.extraContext.slice(0, 500) } : {}) },
      schema: MessageResponseSchema,
    });
    return res.message.trim() ? res.message : null;
  } catch {
    return null;
  }
}

/** Like tryFetchMessage, but a failure quietly yields the per-type fallback string. */
export async function fetchMessage(
  api: ApiClient,
  type: MessageType,
  opts: { extraContext?: string } = {},
): Promise<string> {
  return (await tryFetchMessage(api, type, opts)) ?? fallbackMessage(type);
}

/** Milliseconds until the next local midnight (the server caches the morning briefing per local day). */
export function msUntilLocalMidnight(now: Date = new Date()): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
  return Math.max(1000, next.getTime() - now.getTime());
}

export function fetchDebriefToday(api: ApiClient): Promise<DebriefToday> {
  return api.request("GET", "/api/debrief/today", { schema: DebriefTodayResponseSchema });
}

/** POST /api/debrief/:date/ack. Not an outbox item, so queued logs are flushed first. */
export function ackDebrief(
  api: ApiClient,
  outbox: Pick<Outbox, "flushBeforeMutation">,
  date: string,
  clientId: string,
): Promise<MutationResult<unknown>> {
  return afterOutbox(outbox, () =>
    api.request("POST", `/api/debrief/${encodeURIComponent(date)}/ack`, { body: {}, idempotencyKey: clientId }),
  );
}

/** The shadow gap is a live display value from the game state; the server debrief does not carry it. */
export function toDebriefData(d: ServerDebrief, shadowGap: number): DebriefData {
  return {
    date: d.date,
    domainDeltas: d.deltas,
    questCompleted: d.questCompleted,
    questTotal: d.questTotal,
    shadowGap,
    aiText: d.text,
    verdict: d.verdict,
  };
}

export function fetchWeeklyRecap(api: ApiClient): Promise<WeeklyRecap> {
  return api.request("GET", "/api/recap/weekly", { schema: WeeklyRecapSchema });
}

export function fetchWeeklyDebrief(api: ApiClient): Promise<WeeklyDebrief> {
  return api.request("GET", "/api/recap/weekly/debrief", { schema: WeeklyDebriefResponseSchema });
}

export function fetchCompletionSummary(api: ApiClient, days = 14): Promise<CompletionSummary> {
  return api.request("GET", `/api/system/completions/summary?days=${days}`, { schema: CompletionSummarySchema });
}
