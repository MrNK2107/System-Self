// Social layer: search, follow, block, report. Plain helpers and requests, no React Native imports.
// Every player shown here is a PublicProfile, built by the server's projection: nothing in this module
// ever sees a user id, a hidden score or content of another player's logs or quests.
import {
  FollowersCountResponseSchema,
  PublicProfileListSchema,
  REPORT_REASON_MAX,
  SOCIAL_SEARCH_MIN_CHARS,
  SocialProfileResponseSchema,
  UserReportResponseSchema,
  type PublicProfile,
  type SocialProfileResponse,
  type UserReportResponse,
} from "@workspace/contracts";
import { RANKED_DOMAINS, type RankedDomain } from "@workspace/engine";
import { ApiError, type ApiClient } from "../api/client";
import type { Outbox } from "../api/outbox";
import { afterOutbox, type MutationResult } from "../game/actions";

export { REPORT_REASON_MAX };

export const SOCIAL_POLL_MS = 60_000;
const SEARCH_MAX_CHARS = 32;

/** React Query refetchInterval for social screens: poll every minute while the screen is focused, never in the background. */
export const socialRefetchInterval = (focused: boolean): number | false => (focused ? SOCIAL_POLL_MS : false);

/** The search text as the server wants it, or null while it is shorter than 3 characters. */
export function normalizeSearchQuery(text: string): string | null {
  const t = text.trim().slice(0, SEARCH_MAX_CHARS).trim();
  return t.length >= SOCIAL_SEARCH_MIN_CHARS ? t : null;
}

/** The report reason as the server wants it: trimmed, 1-500 characters. Null when blank. */
export function normalizeReportReason(text: string): string | null {
  const t = text.trim().slice(0, REPORT_REASON_MAX).trim();
  return t.length > 0 ? t : null;
}

/** A handle as a URL path segment (codenames contain spaces and slashes). */
export const playerPath = (handle: string): string => encodeURIComponent(handle);

export interface ProfileSummary {
  rankLine: string;
  trajectoryLine: string;
  shadowLine: string | null;
  /** Ranked-domain scores, present only for relations the server allows them for. */
  scores: { domain: RankedDomain; value: number }[] | null;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function profileSummary(p: PublicProfile): ProfileSummary {
  const scores = p.scores ?? null;
  return {
    rankLine: `RANK ${p.rank}`,
    trajectoryLine: `TRAJECTORY ${p.trajectory.toUpperCase()}`,
    shadowLine: p.shadowActive ? "SHADOW ACTIVE" : null,
    scores: scores ? RANKED_DOMAINS.map((domain) => ({ domain, value: round1(scores[domain]) })) : null,
  };
}

/** What the share sheet sends for the user's own codename (semi-public and anonymous players are found only by it). */
export function codenameShareMessage(codename: string): string {
  return `Find me on SYSTEM // SELF. Search my codename: ${codename}`;
}

/** SYSTEM-voice line for a failed social request. */
export function describeSocialError(err: unknown): string {
  if (!(err instanceof ApiError)) return "The request failed. Retry.";
  if (err.kind === "network") return "No connection. Check your signal and retry.";
  if (err.kind !== "http") return "The system is unavailable. Retry shortly.";
  switch (err.code) {
    case "not_found":
      return "No such player.";
    case "blocked":
      return "That player is blocked.";
    case "self_target":
      return "That is you.";
    case "already_reported":
      return "Already reported. It is under review.";
    case "report_limit":
      return "Report limit reached for today.";
    default:
      return (err.status ?? 0) >= 500 ? "The system is unavailable. Retry shortly." : "The request was rejected.";
  }
}

// --- reads -------------------------------------------------------------------

export function searchPlayers(api: ApiClient, q: string): Promise<PublicProfile[]> {
  return api.request("GET", `/api/social/search?q=${encodeURIComponent(q)}`, { schema: PublicProfileListSchema });
}

export function fetchFollowing(api: ApiClient): Promise<PublicProfile[]> {
  return api.request("GET", "/api/social/following", { schema: PublicProfileListSchema });
}

export async function fetchFollowersCount(api: ApiClient): Promise<number> {
  const r = await api.request("GET", "/api/social/followers/count", { schema: FollowersCountResponseSchema });
  return r.count;
}

export function fetchSocialProfile(api: ApiClient, handle: string): Promise<SocialProfileResponse> {
  return api.request("GET", `/api/social/profile/${playerPath(handle)}`, { schema: SocialProfileResponseSchema });
}

// --- mutations (plain mutations: queued logs land first) -----------------------

type Guard = Pick<Outbox, "flushBeforeMutation">;

export function followPlayer(api: ApiClient, outbox: Guard, handle: string, clientId: string): Promise<MutationResult<unknown>> {
  return afterOutbox(outbox, () => api.request("POST", `/api/social/follow/${playerPath(handle)}`, { idempotencyKey: clientId }));
}

export function unfollowPlayer(api: ApiClient, outbox: Guard, handle: string, clientId: string): Promise<MutationResult<unknown>> {
  return afterOutbox(outbox, () => api.request("DELETE", `/api/social/follow/${playerPath(handle)}`, { idempotencyKey: clientId }));
}

export function blockPlayer(api: ApiClient, outbox: Guard, handle: string, clientId: string): Promise<MutationResult<unknown>> {
  return afterOutbox(outbox, () => api.request("POST", `/api/social/block/${playerPath(handle)}`, { idempotencyKey: clientId }));
}

export function unblockPlayer(api: ApiClient, outbox: Guard, handle: string, clientId: string): Promise<MutationResult<unknown>> {
  return afterOutbox(outbox, () => api.request("DELETE", `/api/social/block/${playerPath(handle)}`, { idempotencyKey: clientId }));
}

export function reportPlayer(
  api: ApiClient,
  outbox: Guard,
  handle: string,
  reason: string,
  clientId: string,
): Promise<MutationResult<UserReportResponse>> {
  const clean = normalizeReportReason(reason);
  if (!clean) return Promise.reject(new Error("A report needs a reason."));
  return afterOutbox(outbox, () =>
    api.request("POST", "/api/social/report", {
      body: { subject: handle, reason: clean, clientId },
      idempotencyKey: clientId,
      schema: UserReportResponseSchema,
    }),
  );
}
