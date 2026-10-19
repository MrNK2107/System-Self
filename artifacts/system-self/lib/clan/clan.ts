// Clans (GET/POST /api/clans/*): plain helpers and requests, no React Native imports. Members are clanmate
// projections built by the server (usernames always, PRD 16); the hidden score never reaches the app. Mutations
// run after the outbox (queued logs land first).
import {
  CLAN_DESCRIPTION_MAX,
  CLAN_MAX_MEMBERS,
  CLAN_MIN_ACTIVE,
  CLAN_NAME_MAX,
  CLAN_NAME_MIN,
  CLAN_NAME_RE,
  CLAN_TAG_RE,
  ClanLeaderboardResponseSchema,
  ClanSchema,
  ClanSearchResponseSchema,
  MyClanResponseSchema,
  type Clan,
  type ClanLeaderboardItem,
  type ClanMember,
  type ClanSummary,
  type MyClanResponse,
} from "@workspace/contracts";
import { ApiError, type ApiClient } from "../api/client";
import type { Outbox } from "../api/outbox";
import { isProRequired } from "../api/pro";
import { afterOutbox, type MutationResult } from "../game/actions";

export { CLAN_MAX_MEMBERS, CLAN_MIN_ACTIVE };

/** The account screen where the email is verified (founding a clan requires it). */
export const VERIFY_EMAIL_ROUTE = "/settings/account";

// --- input -------------------------------------------------------------------------------------

export interface ClanDraft {
  name: string;
  tag: string;
  description: string;
}

/** Tags are typed in any case and sent upper-case, letters only. */
export const normalizeTag = (text: string): string => text.replace(/[^A-Za-z]/g, "").toUpperCase().slice(0, 5);

/** Invite codes are sent upper-case without spaces. */
export const normalizeInviteCode = (text: string): string => text.replace(/\s+/g, "").toUpperCase();

/** The first problem with a draft, in the SYSTEM voice, or null when it can be sent. */
export function validateClanDraft(d: ClanDraft): string | null {
  const name = d.name.trim();
  if (name.length < CLAN_NAME_MIN || name.length > CLAN_NAME_MAX) return `Name: ${CLAN_NAME_MIN}–${CLAN_NAME_MAX} characters.`;
  if (!CLAN_NAME_RE.test(name)) return "Name: letters, digits, spaces, _ and - only.";
  if (!CLAN_TAG_RE.test(d.tag)) return "Tag: 2–5 letters.";
  if (d.description.trim().length > CLAN_DESCRIPTION_MAX) return `Description: ${CLAN_DESCRIPTION_MAX} characters at most.`;
  return null;
}

/** The request body for a valid draft. */
export function clanCreateBody(d: ClanDraft, clientId: string) {
  const description = d.description.trim();
  return { name: d.name.trim(), tag: d.tag, ...(description ? { description } : {}), clientId };
}

// --- display -----------------------------------------------------------------------------------

/** `IRON WOLVES [IRON]` */
export const clanLabel = (c: Pick<ClanSummary, "name" | "tag">): string => `${c.name.toUpperCase()} [${c.tag}]`;

/** One status line: how far a forming clan is from 8, or an active clan's rank. */
export function clanStatusLine(c: Pick<ClanSummary, "status" | "memberCount" | "clanRank">): string {
  if (c.status === "forming") {
    const need = Math.max(0, CLAN_MIN_ACTIVE - c.memberCount);
    return `FORMING — ${c.memberCount}/${CLAN_MIN_ACTIVE}. ${need} more operator${need === 1 ? "" : "s"} required for raids and rank.`;
  }
  return c.clanRank ? `ACTIVE — RANK #${c.clanRank}. ${c.memberCount}/${CLAN_MAX_MEMBERS} operators.` : `ACTIVE — UNRANKED UNTIL 00:30 UTC. ${c.memberCount}/${CLAN_MAX_MEMBERS} operators.`;
}

export const isFull = (c: Pick<ClanSummary, "memberCount">): boolean => c.memberCount >= CLAN_MAX_MEMBERS;

/** `75%`, or `—` with nothing resolved in 30 days. */
export const completionLabel = (rate: number | null): string => (rate === null ? "—" : `${rate}%`);

/** The members a leader may remove: flagged dead weight, never the leader. */
export const removableMembers = (members: ClanMember[]): ClanMember[] => members.filter((m) => m.flagged && m.role !== "leader");

/** The members leadership can pass to: everyone but the viewer. */
export const transferCandidates = (members: ClanMember[]): ClanMember[] => members.filter((m) => !m.isSelf);

export const isLeader = (data: MyClanResponse | undefined): boolean => data?.clan?.myRole === "leader";

/** What the leave button must do: leave, or ask the leader to transfer first (others remain). */
export function leaveBlocker(data: MyClanResponse): string | null {
  if (!data.clan || data.clan.myRole !== "leader") return null;
  return data.members.length > 1 ? "Transfer leadership before leaving." : null;
}

/** The error a founding attempt maps to: a PRO lock, an email prompt, or a message. */
export type CreateOutcome = { kind: "pro" } | { kind: "verify_email" } | { kind: "error"; message: string };

export function createErrorOutcome(err: unknown): CreateOutcome {
  if (isProRequired(err)) return { kind: "pro" };
  if (err instanceof ApiError && err.kind === "http" && err.status === 403 && err.code === "email_unverified") return { kind: "verify_email" };
  return { kind: "error", message: describeClanError(err) };
}

/** SYSTEM-voice line for a failed clan request. */
export function describeClanError(err: unknown): string {
  if (!(err instanceof ApiError)) return "The request failed. Retry.";
  if (isProRequired(err)) return "PRO required.";
  if (err.kind === "network") return "No connection. Check your signal and retry.";
  if (err.kind !== "http") return "The system is unavailable. Retry shortly.";
  switch (err.code) {
    case "email_unverified":
      return "Verify your email to found a clan.";
    case "already_in_clan":
      return "You are already in a clan. One clan per operator.";
    case "clan_full":
      return `Clan is full. ${CLAN_MAX_MEMBERS} operators maximum.`;
    case "leader_must_transfer":
      return "Transfer leadership before leaving.";
    case "not_flagged":
      return "Only members flagged as dead weight can be removed.";
    case "not_leader":
      return "Only the clan leader can do this.";
    case "not_in_clan":
      return "You are not in a clan.";
    case "name_taken":
      return "That clan name is taken.";
    case "blocked":
      return "A block stands between you and a member of this clan.";
    case "not_found":
      return "Clan or code not recognised.";
    default:
      if (err.status === 400) return "Check the fields and retry.";
      return (err.status ?? 0) >= 500 ? "The system is unavailable. Retry shortly." : "The request was rejected.";
  }
}

/** The message for a mutation that did not go out because queued entries are still syncing. */
export const SYNC_PENDING_MESSAGE = "Queued entries are still syncing. Retry once they land.";

// --- requests ------------------------------------------------------------------------------------

type Guard = Pick<Outbox, "flushBeforeMutation">;
const seg = encodeURIComponent;

export function fetchMyClan(api: ApiClient): Promise<MyClanResponse> {
  return api.request("GET", "/api/clans/mine", { schema: MyClanResponseSchema });
}

export async function searchClans(api: ApiClient, q: string): Promise<ClanSummary[]> {
  const r = await api.request("GET", `/api/clans/search?q=${seg(q.trim())}`, { schema: ClanSearchResponseSchema });
  return r.items;
}

export async function fetchClanLeaderboard(api: ApiClient, limit = 50): Promise<ClanLeaderboardItem[]> {
  const r = await api.request("GET", `/api/clans/leaderboard?limit=${limit}`, { schema: ClanLeaderboardResponseSchema });
  return r.items;
}

export function createClan(api: ApiClient, outbox: Guard, draft: ClanDraft, clientId: string): Promise<MutationResult<Clan>> {
  return afterOutbox(outbox, () =>
    api.request("POST", "/api/clans", { body: clanCreateBody(draft, clientId), idempotencyKey: clientId, schema: ClanSchema }),
  );
}

export function joinClanById(api: ApiClient, outbox: Guard, clanId: string, clientId: string): Promise<MutationResult<unknown>> {
  return afterOutbox(outbox, () => api.request("POST", `/api/clans/${seg(clanId)}/join`, { idempotencyKey: clientId }));
}

export function joinClanByCode(api: ApiClient, outbox: Guard, code: string, clientId: string): Promise<MutationResult<unknown>> {
  return afterOutbox(outbox, () =>
    api.request("POST", "/api/clans/join", { body: { inviteCode: normalizeInviteCode(code), clientId }, idempotencyKey: clientId }),
  );
}

export function leaveClan(api: ApiClient, outbox: Guard, clientId: string): Promise<MutationResult<unknown>> {
  return afterOutbox(outbox, () => api.request("POST", "/api/clans/leave", { idempotencyKey: clientId }));
}

export function removeClanMember(api: ApiClient, outbox: Guard, userId: string, clientId: string): Promise<MutationResult<unknown>> {
  return afterOutbox(outbox, () => api.request("POST", `/api/clans/members/${seg(userId)}/remove`, { idempotencyKey: clientId }));
}

export function transferClanLeader(api: ApiClient, outbox: Guard, userId: string, clientId: string): Promise<MutationResult<unknown>> {
  return afterOutbox(outbox, () => api.request("POST", "/api/clans/leader", { body: { userId, clientId }, idempotencyKey: clientId }));
}
