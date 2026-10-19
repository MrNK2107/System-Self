// Party of Two (GET/POST /api/duo...): plain helpers and requests, no React Native imports. The partner is a
// PublicProfile from the server's duo projection (username, rank, trajectory; never scores) and the check-ins are
// kinds plus timestamps. Nothing here touches score. Mutations run after the outbox (queued logs land first).
import {
  DUO_CHECKINS_PER_DAY,
  DUO_NUDGES_PER_DAY,
  DuoCheckinResponseSchema,
  DuoInviteResponseSchema,
  DuoResponseSchema,
  type DuoCheckinItem,
  type DuoCheckinKind,
  type DuoInviteItem,
  type DuoResponse,
} from "@workspace/contracts";
import { ApiError, type ApiClient } from "../api/client";
import type { Outbox } from "../api/outbox";
import { afterOutbox, type MutationResult } from "../game/actions";

export { DUO_CHECKINS_PER_DAY, DUO_NUDGES_PER_DAY };

/** The check-in buttons, in order. */
export const DUO_BUTTONS: readonly { kind: DuoCheckinKind; label: string }[] = [
  { kind: "going_now", label: "GOING NOW" },
  { kind: "checked_in", label: "CHECKED IN" },
  { kind: "done", label: "DONE" },
];

export const duoKindLabel = (kind: DuoCheckinKind): string => DUO_BUTTONS.find((b) => b.kind === kind)!.label;

/** `3m ago`, `2h ago`, `5d ago`, `just now`. */
export function agoLabel(iso: string, now: Date): string {
  const mins = Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
  return `${Math.floor(mins / 1440)}d ago`;
}

/** `GOING NOW // yuri_1 // 2h ago` (the viewer's own check-ins read `YOU`). */
export function checkinLine(c: DuoCheckinItem, partnerHandle: string, now: Date): string {
  return `${duoKindLabel(c.kind)} // ${c.fromMe ? "YOU" : partnerHandle} // ${agoLabel(c.createdAt, now)}`;
}

/** The newest check-ins, newest first, at most `n`. */
export const latestCheckins = (items: readonly DuoCheckinItem[], n: number): DuoCheckinItem[] =>
  [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, n);

export const incomingInvites = (view: Pick<DuoResponse, "pendingInvites">): DuoInviteItem[] =>
  view.pendingInvites.filter((i) => i.direction === "incoming");

/** The dashboard card shows for a duo or while an invite waits for an answer. */
export const hasDuoActivity = (view: DuoResponse | undefined): boolean =>
  !!view && (!!view.partner || incomingInvites(view).length > 0);

/** SYSTEM-voice line for a failed duo request. */
export function describeDuoError(err: unknown): string {
  if (!(err instanceof ApiError)) return "The request failed. Retry.";
  if (err.kind === "network") return "No connection. Check your signal and retry.";
  if (err.kind !== "http") return "The system is unavailable. Retry shortly.";
  switch (err.code) {
    case "nudge_limit":
      return `${DUO_NUDGES_PER_DAY} nudges a day is the limit. Logged.`;
    case "already_in_duo":
      return "A Party of Two is already formed. One partner at a time.";
    case "unavailable":
      return "That operator can't take a partner right now.";
    case "checkin_limit":
      return `${DUO_CHECKINS_PER_DAY} check-ins a day is the limit. Logged.`;
    case "invite_open":
      return "An invite between you is already open.";
    case "invite_limit":
      return "Too many open invites. Wait for an answer.";
    case "not_pending":
      return "That invite is no longer open.";
    case "not_in_duo":
      return "You are not in a Party of Two.";
    case "self_target":
      return "You cannot invite yourself.";
    case "not_found":
      return "Player not found.";
    default:
      if (err.status === 404) return "Player not found.";
      if (err.status === 400) return "Check the fields and retry.";
      return (err.status ?? 0) >= 500 ? "The system is unavailable. Retry shortly." : "The request was rejected.";
  }
}

// --- requests ----------------------------------------------------------------------------------------

type Guard = Pick<Outbox, "flushBeforeMutation">;
const seg = encodeURIComponent;

export function fetchDuo(api: ApiClient): Promise<DuoResponse> {
  return api.request("GET", "/api/duo", { schema: DuoResponseSchema });
}

/** `username` is the handle exactly as shown (a public username or a codename). */
export function inviteToDuo(api: ApiClient, outbox: Guard, username: string, clientId: string): Promise<MutationResult<DuoInviteItem>> {
  return afterOutbox(outbox, () =>
    api.request("POST", "/api/duo/invite", { body: { username: username.trim(), clientId }, idempotencyKey: clientId, schema: DuoInviteResponseSchema }),
  );
}

export function answerDuoInvite(
  api: ApiClient,
  outbox: Guard,
  id: string,
  verb: "accept" | "decline",
  clientId: string,
): Promise<MutationResult<DuoResponse>> {
  return afterOutbox(outbox, () =>
    api.request("POST", `/api/duo/invites/${seg(id)}/${verb}`, { body: { clientId }, idempotencyKey: clientId, schema: DuoResponseSchema }),
  );
}

export function leaveDuo(api: ApiClient, outbox: Guard, clientId: string): Promise<MutationResult<unknown>> {
  return afterOutbox(outbox, () => api.request("POST", "/api/duo/leave", { body: { clientId }, idempotencyKey: clientId }));
}

export function sendDuoCheckin(api: ApiClient, outbox: Guard, kind: DuoCheckinKind, clientId: string): Promise<MutationResult<DuoCheckinItem>> {
  return afterOutbox(outbox, () =>
    api.request("POST", "/api/duo/checkin", { body: { kind, clientId }, idempotencyKey: clientId, schema: DuoCheckinResponseSchema }),
  );
}
