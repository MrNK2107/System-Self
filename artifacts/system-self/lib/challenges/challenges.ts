// PRO named challenges (GET/POST /api/challenges): plain helpers and requests, no React Native imports. The other
// player is only ever a handle the server projected (a username in a clan or for a public player, else a public
// codename). The only numbers are the two domain-score gains in the challenged domain: no other score, no hidden
// score. Mutations run after the outbox (queued logs land first).
import {
  CHALLENGE_IGNORED_LINE,
  CHALLENGE_LOSS_DELTA,
  CHALLENGE_MAX_OPEN,
  CHALLENGE_RESPOND_HOURS,
  CHALLENGE_WIN_DELTA,
  ChallengeListResponseSchema,
  ChallengeSchema,
  NAMED_CHALLENGE_DAYS,
  type Challenge,
} from "@workspace/contracts";
import type { RankedDomain } from "@workspace/engine";
import { ApiError, type ApiClient } from "../api/client";
import type { Outbox } from "../api/outbox";
import { isProRequired } from "../api/pro";
import { afterOutbox, type MutationResult } from "../game/actions";

export { CHALLENGE_IGNORED_LINE, CHALLENGE_MAX_OPEN, CHALLENGE_RESPOND_HOURS };
export const CHALLENGE_DAYS = NAMED_CHALLENGE_DAYS;

/** The stake, shown before sending. */
export const CHALLENGE_RULE = `The window opens the day after acceptance. Highest domain gain wins. Winner +${CHALLENGE_WIN_DELTA.toFixed(1)} DISCIPLINE, loser ${CHALLENGE_LOSS_DELTA.toFixed(1)}. A draw changes nothing.`;

export interface ChallengeDraft {
  opponent: string;
  domain: RankedDomain;
  days: (typeof NAMED_CHALLENGE_DAYS)[number];
}

export function challengeCreateBody(d: ChallengeDraft, clientId: string) {
  return { opponent: d.opponent.trim(), domain: d.domain, days: d.days, clientId };
}

// --- display -------------------------------------------------------------------------------------

/** `+4.0`, `-1.3`, `0.0` */
export function gainLabel(n: number): string {
  const r = Math.round(n * 10) / 10;
  return r > 0 ? `+${r.toFixed(1)}` : r.toFixed(1);
}

/** `MIND // 7 DAYS vs yuri_1` (`[GONE]` once the other account is deleted). */
export const challengeHeadline = (c: Pick<Challenge, "domain" | "days" | "opponent">): string =>
  `${c.domain} // ${c.days} DAYS vs ${c.opponent.handle ?? "[GONE]"}`;

/** The live comparison of an active challenge, from the viewer's side; empty when there are no gains yet. */
export function standingLine(c: Pick<Challenge, "myGain" | "theirGain">): string {
  if (c.myGain === null || c.theirGain === null) return "";
  const gap = Math.round((c.myGain - c.theirGain) * 10) / 10;
  if (gap === 0) return "TIED";
  return gap > 0 ? `LEADING BY ${gap.toFixed(1)}` : `TRAILING BY ${Math.abs(gap).toFixed(1)}`;
}

/** The one line under a challenge: its state in the SYSTEM voice. */
export function statusLine(c: Challenge): string {
  switch (c.status) {
    case "pending":
      return c.role === "challenger" ? "Waiting for an answer." : `Answer within ${CHALLENGE_RESPOND_HOURS} hours or it is ignored.`;
    case "active":
      return c.startDate && c.endDate ? `Window ${c.startDate} to ${c.endDate}.` : "Running.";
    case "ignored":
      return c.line ?? "Ignored.";
    case "void":
      return "VOID. No score change.";
    case "resolved":
      if (c.outcome === "win") return `WON. +${CHALLENGE_WIN_DELTA.toFixed(1)} DISCIPLINE.`;
      if (c.outcome === "loss") return `LOST. ${CHALLENGE_LOSS_DELTA.toFixed(1)} DISCIPLINE.`;
      return "DRAW. No score change.";
  }
}

/** Time left to answer: `1d 4h left`, `5h 30m left`, `10m left`, or `closing`. */
export function respondTimeLeft(respondBy: string, now: Date): string {
  const ms = new Date(respondBy).getTime() - now.getTime();
  if (ms <= 0) return "closing";
  const mins = Math.floor(ms / 60_000);
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  if (d > 0) return `${d}d ${h}h left`;
  if (h > 0) return `${h}h ${m}m left`;
  return `${Math.max(1, m)}m left`;
}

export interface ChallengeGroups {
  /** Waiting for the viewer's answer (viewer is the opponent). */
  incoming: Challenge[];
  /** Sent by the viewer, not yet answered. */
  sent: Challenge[];
  active: Challenge[];
  /** Ignored, resolved and void, newest first as the server sent them. */
  closed: Challenge[];
}

export function groupChallenges(items: readonly Challenge[]): ChallengeGroups {
  return {
    incoming: items.filter((c) => c.status === "pending" && c.role === "opponent"),
    sent: items.filter((c) => c.status === "pending" && c.role === "challenger"),
    active: items.filter((c) => c.status === "active"),
    closed: items.filter((c) => c.status === "ignored" || c.status === "resolved" || c.status === "void"),
  };
}

// --- errors ----------------------------------------------------------------------------------------

/** What a failed create resolves to: a PRO lock or a message. */
export type CreateOutcome = { kind: "pro" } | { kind: "error"; message: string };

export function createOutcome(err: unknown): CreateOutcome {
  return isProRequired(err) ? { kind: "pro" } : { kind: "error", message: describeChallengeError(err) };
}

/** SYSTEM-voice line for a failed challenge or Shame Mode request. */
export function describeChallengeError(err: unknown): string {
  if (!(err instanceof ApiError)) return "The request failed. Retry.";
  if (isProRequired(err)) return "PRO required.";
  if (err.kind === "network") return "No connection. Check your signal and retry.";
  if (err.kind !== "http") return "The system is unavailable. Retry shortly.";
  switch (err.code) {
    case "not_eligible":
      return "You can only challenge a player you follow or a clanmate.";
    case "challenge_limit":
      return "Three open challenges is the limit. Finish or answer one first.";
    case "opponent_busy":
      return "That player has too many open challenges.";
    case "challenge_open":
      return "A challenge between you is already open.";
    case "expired":
      return "The 48 hours to answer have passed. It was ignored. Logged.";
    case "not_pending":
      return "That challenge is no longer waiting for an answer.";
    case "self_challenge":
      return "You cannot challenge yourself.";
    case "not_in_clan":
      return "Join a clan to use Shame Mode.";
    case "not_active":
      return "That quest is no longer active.";
    case "not_found":
      return "Player or challenge not found.";
    default:
      if (err.status === 404) return "Player or challenge not found.";
      if (err.status === 400) return "Check the fields and retry.";
      return (err.status ?? 0) >= 500 ? "The system is unavailable. Retry shortly." : "The request was rejected.";
  }
}

// --- requests ----------------------------------------------------------------------------------------

type Guard = Pick<Outbox, "flushBeforeMutation">;
const seg = encodeURIComponent;

export async function fetchChallenges(api: ApiClient): Promise<Challenge[]> {
  return (await api.request("GET", "/api/challenges", { schema: ChallengeListResponseSchema })).items;
}

export function createChallenge(api: ApiClient, outbox: Guard, draft: ChallengeDraft, clientId: string): Promise<MutationResult<Challenge>> {
  return afterOutbox(outbox, () =>
    api.request("POST", "/api/challenges", { body: challengeCreateBody(draft, clientId), idempotencyKey: clientId, schema: ChallengeSchema }),
  );
}

export function acceptChallenge(api: ApiClient, outbox: Guard, id: string, clientId: string): Promise<MutationResult<Challenge>> {
  return afterOutbox(outbox, () =>
    api.request("POST", `/api/challenges/${seg(id)}/accept`, { body: { clientId }, idempotencyKey: clientId, schema: ChallengeSchema }),
  );
}

export function ignoreChallenge(api: ApiClient, outbox: Guard, id: string, clientId: string): Promise<MutationResult<Challenge>> {
  return afterOutbox(outbox, () =>
    api.request("POST", `/api/challenges/${seg(id)}/ignore`, { body: { clientId }, idempotencyKey: clientId, schema: ChallengeSchema }),
  );
}
