// Clan peer ratings (GET /api/clans/ratings/mine, POST /api/clans/ratings): plain helpers and requests, no React
// Native imports. Ratings are anonymous: the app only ever reads what the viewer gave, never who rated them.
import { PeerRatingsMineSchema, type ClanMember, type PeerRatingsMine } from "@workspace/contracts";
import { PEER_RATINGS_PER_WEEK } from "@workspace/engine";
import { ApiError, type ApiClient } from "../api/client";
import type { Outbox } from "../api/outbox";
import { afterOutbox, type MutationResult } from "../game/actions";

export const RATING_ANONYMITY_LINE = "Ratings are anonymous. Rate the output, not the person.";
export const RATING_VALUES = [1, 2, 3, 4, 5] as const;

/** The clanmates one can rate: everyone but the viewer. */
export const rateableMembers = (members: ClanMember[]): ClanMember[] => members.filter((m) => !m.isSelf);

/** The rating the viewer gave a clanmate this week (by username), or null. */
export const ratedValue = (view: PeerRatingsMine | undefined, handle: string): number | null =>
  view?.given.find((g) => g.rateeHandle === handle)?.rating ?? null;

/** A clanmate can be rated while a slot is free; one already rated this week can always be re-rated (same slot). */
export function canRate(view: PeerRatingsMine | undefined, handle: string): boolean {
  if (!view) return false;
  return view.remaining > 0 || ratedValue(view, handle) !== null;
}

export function remainingLine(remaining: number): string {
  if (remaining <= 0) return "No ratings remaining this week. You can still change one you gave.";
  return `${remaining} rating${remaining === 1 ? "" : "s"} remaining this week.`;
}

/** SYSTEM-voice line for a failed rating request. */
export function describeRatingError(err: unknown): string {
  if (!(err instanceof ApiError)) return "The request failed. Retry.";
  if (err.kind === "network") return "No connection. Check your signal and retry.";
  if (err.kind !== "http") return "The system is unavailable. Retry shortly.";
  switch (err.code) {
    case "not_eligible":
      return "Ratings open once you and that operator have both been in the clan for 7 days.";
    case "rating_limit":
      return `At most ${PEER_RATINGS_PER_WEEK} clanmates a week.`;
    case "self_target":
      return "You cannot rate yourself.";
    default:
      if (err.status === 400) return "Check the fields and retry.";
      return (err.status ?? 0) >= 500 ? "The system is unavailable. Retry shortly." : "The request was rejected.";
  }
}

export function fetchRatings(api: ApiClient): Promise<PeerRatingsMine> {
  return api.request("GET", "/api/clans/ratings/mine", { schema: PeerRatingsMineSchema });
}

/** Rates (or re-rates) a clanmate; sent after the outbox. The response is the viewer's updated week. */
export function submitRating(
  api: ApiClient,
  outbox: Pick<Outbox, "flushBeforeMutation">,
  rateeUserId: string,
  rating: number,
  clientId: string,
): Promise<MutationResult<PeerRatingsMine>> {
  return afterOutbox(outbox, () =>
    api.request("POST", "/api/clans/ratings", { body: { rateeUserId, rating, clientId }, idempotencyKey: clientId, schema: PeerRatingsMineSchema }),
  );
}
