// Rivals from the server (GET /api/rivals): slots, challenges, transmissions. Plain helpers and requests, no
// React Native imports. Every rival is a PublicProfile built by the server's projection (a real rival is shown
// by its assignment codename, a ghost is a server simulation). The composite shown here is the plain mean of
// the five visible domain scores; the hidden score never reaches the client.
import {
  RIVAL_CHALLENGE_DAYS,
  RivalChallengeSchema,
  RivalTauntSchema,
  RivalsResponseSchema,
  type Rank,
  type RankedDomain,
  type RivalChallenge,
  type RivalTaunt,
  type RivalsResponse,
} from "@workspace/contracts";
import { RANKED_DOMAINS, daysBetween } from "@workspace/engine";
import { ApiError, type ApiClient } from "../api/client";
import type { Outbox } from "../api/outbox";
import { afterOutbox, type MutationResult } from "../game/actions";
import { isProRequired } from "../api/pro";

export type Trajectory = "up" | "stable" | "down";
export type Scores = Record<RankedDomain, number>;

const round1 = (n: number) => Math.round(n * 10) / 10;

/** `RIVAL // ASH-3` -> `ASH-3`. */
export const shortCodename = (codename: string): string => codename.split(" // ")[1] ?? codename;

/** Plain mean of the five ranked domain scores. */
export function composite(scores: Scores): number {
  const sum = RANKED_DOMAINS.reduce((acc, d) => acc + (scores[d] ?? 0), 0);
  return round1(sum / RANKED_DOMAINS.length);
}

export interface LeaderEntry {
  id: string;
  kind: "you" | "shadow" | "rival";
  label: string;
  rank: Rank;
  trajectory: Trajectory;
  composite: number;
  scores: Scores;
  shadowActive: boolean;
  /** A server simulation (cold start): shown with a SIM tag. */
  isGhost: boolean;
}

export interface Leaderboard {
  entries: LeaderEntry[];
  position: number;
  losingTo: number;
  surpassing: number;
  userComposite: number;
}

/** You, your active shadow and every rival, best composite first. */
export function buildLeaderboard(
  me: { handle: string; rank: Rank; trajectory: Trajectory; scores: Scores },
  data: RivalsResponse,
): Leaderboard {
  const entries: LeaderEntry[] = [
    { id: "you", kind: "you", label: me.handle, rank: me.rank, trajectory: me.trajectory, composite: composite(me.scores), scores: me.scores, shadowActive: false, isGhost: false },
  ];
  if (data.shadow) {
    entries.push({
      id: "shadow",
      kind: "shadow",
      label: data.shadow.codename,
      rank: data.shadow.rank,
      trajectory: "up",
      composite: composite(data.shadow.scores),
      scores: data.shadow.scores,
      shadowActive: false,
      isGhost: false,
    });
  }
  for (const r of data.rivals) {
    const scores = r.profile.scores ?? (Object.fromEntries(RANKED_DOMAINS.map((d) => [d, 0])) as Scores);
    entries.push({
      id: r.assignmentId,
      kind: "rival",
      label: r.codename,
      rank: r.profile.rank,
      trajectory: r.profile.trajectory,
      composite: composite(scores),
      scores,
      shadowActive: r.profile.shadowActive,
      isGhost: r.isGhost,
    });
  }
  const userComposite = entries[0]!.composite;
  const sorted = [...entries].sort((a, b) => b.composite - a.composite);
  return {
    entries: sorted,
    position: sorted.findIndex((e) => e.kind === "you") + 1,
    losingTo: sorted.filter((e) => e.kind !== "you" && e.composite > userComposite).length,
    surpassing: sorted.filter((e) => e.kind !== "you" && e.composite < userComposite).length,
    userComposite,
  };
}

export type LeaderStatus = "THREATENING" | "CLOSING" | "AHEAD" | "BEHIND" | "SHADOW";

/** The old leaderboard labels: THREATENING (ahead and rising), AHEAD, CLOSING (within 8 and rising), BEHIND. */
export function leaderStatus(entry: Pick<LeaderEntry, "kind" | "composite" | "trajectory">, userComposite: number): LeaderStatus | null {
  if (entry.kind === "you") return null;
  if (entry.kind === "shadow") return "SHADOW";
  const delta = entry.composite - userComposite;
  if (delta > 0 && entry.trajectory === "up") return "THREATENING";
  if (delta > 0) return "AHEAD";
  if (delta > -8 && entry.trajectory === "up") return "CLOSING";
  return "BEHIND";
}

export interface ChallengeProgress {
  userGain: number;
  rivalGain: number;
  leading: boolean;
  /** Local days left including today; 0 once the window is over. */
  daysLeft: number;
  pct: number;
}

/** Progress of a 7-day challenge on the user's local `today`. */
export function challengeProgress(c: RivalChallenge, today: string): ChallengeProgress {
  const userGain = round1(c.userCurrent - c.userStart);
  const rivalGain = round1(c.rivalCurrent - c.rivalStart);
  const over = c.outcome !== null || today > c.endDate;
  const elapsed = Math.min(RIVAL_CHALLENGE_DAYS, Math.max(0, daysBetween(c.startDate, today)));
  return {
    userGain,
    rivalGain,
    leading: userGain >= rivalGain,
    daysLeft: over ? 0 : daysBetween(today, c.endDate) + 1,
    pct: over ? 100 : (elapsed / RIVAL_CHALLENGE_DAYS) * 100,
  };
}

/** SYSTEM-voice line for a failed rival request. */
export function describeRivalError(err: unknown): string {
  if (!(err instanceof ApiError)) return "The request failed. Retry.";
  if (isProRequired(err)) return "PRO required.";
  if (err.kind === "network") return "No connection. Check your signal and retry.";
  if (err.kind !== "http") return "The system is unavailable. Retry shortly.";
  switch (err.code) {
    case "challenge_open":
      return "A challenge against this rival is already running.";
    case "taunt_limit":
      return "One transmission per rival per day.";
    case "message_limit":
      return "Transmission limit reached for today.";
    case "not_found":
      return "That rival is gone. Pull to refresh.";
    default:
      return (err.status ?? 0) >= 500 ? "The system is unavailable. Retry shortly." : "The request was rejected.";
  }
}

/**
 * Runs a challenge declaration and returns what the sheet must show: null once the server confirmed it, else the
 * SYSTEM-voice reason it did not land. The sheet plays its "declared" confirmation only on null.
 */
export async function declareOutcomeMessage(send: () => Promise<MutationResult<unknown>>): Promise<string | null> {
  try {
    const r = await send();
    return r.ok ? null : "Queued entries are still syncing. Retry once they land.";
  } catch (e) {
    return describeRivalError(e);
  }
}

// --- requests ------------------------------------------------------------------------------------

export function fetchRivals(api: ApiClient): Promise<RivalsResponse> {
  return api.request("GET", "/api/rivals", { schema: RivalsResponseSchema });
}

type Guard = Pick<Outbox, "flushBeforeMutation">;
const seg = encodeURIComponent;

export function declareRivalChallenge(
  api: ApiClient,
  outbox: Guard,
  assignmentId: string,
  domain: RankedDomain,
  clientId: string,
): Promise<MutationResult<RivalChallenge>> {
  return afterOutbox(outbox, () =>
    api.request("POST", `/api/rivals/${seg(assignmentId)}/challenge`, {
      body: { domain, clientId },
      idempotencyKey: clientId,
      schema: RivalChallengeSchema,
    }),
  );
}

export function ackRivalChallenge(api: ApiClient, outbox: Guard, challengeId: string, clientId: string): Promise<MutationResult<unknown>> {
  return afterOutbox(outbox, () => api.request("POST", `/api/rivals/challenges/${seg(challengeId)}/ack`, { idempotencyKey: clientId }));
}

export function tauntRival(api: ApiClient, outbox: Guard, assignmentId: string, clientId: string): Promise<MutationResult<RivalTaunt>> {
  return afterOutbox(outbox, () =>
    api.request("POST", `/api/rivals/${seg(assignmentId)}/taunt`, { idempotencyKey: clientId, schema: RivalTauntSchema }),
  );
}

export function markTauntsRead(api: ApiClient, outbox: Guard, clientId: string): Promise<MutationResult<unknown>> {
  return afterOutbox(outbox, () => api.request("POST", "/api/rivals/taunts/read", { idempotencyKey: clientId }));
}
