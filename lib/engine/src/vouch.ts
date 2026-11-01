/**
 * Vouching (spec 8.6): a friend or clan member confirms a quest. The owner's rule: a voucher is eligible only if
 * their own quest that day is proven; if it is proven only by someone else's vouch, follow the chain upward until it
 * reaches someone proven directly (a session, a quiz, health or money data). No direct proof at the top, or a chain
 * deeper than VOUCH_CHAIN_MAX_DEPTH, and the vouch doesn't count.
 */
export const VOUCH_CHAIN_MAX_DEPTH = 3;
/** Confirmations one person can give in a rolling week. */
export const VOUCHES_PER_WEEK = 3;
/** The same voucher can confirm the same requester at most this often in a rolling week. */
export const VOUCHES_PER_PAIR_PER_WEEK = 1;
/** A request the voucher never answers lapses after a day. */
export const VOUCH_REQUEST_TTL_MS = 24 * 3600_000;

/** One accepted proof a user has today: direct, or a vouch given by `voucherId`. */
export type DayProof = { direct: true } | { direct: false; voucherId: string };

/**
 * Is `userId` anchored today: proven directly, or vouched for by someone who is anchored, within the depth limit?
 * `proofs` holds each user's accepted proofs for the day. Cycles (A vouched B, B vouched A) never anchor.
 */
export function isAnchored(
  userId: string,
  proofs: ReadonlyMap<string, readonly DayProof[]>,
  maxDepth = VOUCH_CHAIN_MAX_DEPTH,
): boolean {
  const walk = (id: string, depth: number, seen: Set<string>): boolean => {
    const mine = proofs.get(id) ?? [];
    if (mine.some((p) => p.direct)) return true;
    if (depth >= maxDepth) return false;
    for (const p of mine) {
      if (p.direct || seen.has(p.voucherId)) continue;
      if (walk(p.voucherId, depth + 1, new Set([...seen, p.voucherId]))) return true;
    }
    return false;
  };
  return walk(userId, 1, new Set([userId]));
}

export type VouchRefusal = "voucher_unproven" | "weekly_limit" | "pair_limit" | "self";

/** Whether `voucherId` may confirm `requesterId` now, given their recent confirmations and today's proofs. */
export function vouchAllowed(input: {
  voucherId: string;
  requesterId: string;
  confirmationsThisWeek: number;
  pairConfirmationsThisWeek: number;
  proofs: ReadonlyMap<string, readonly DayProof[]>;
}): { ok: true } | { ok: false; code: VouchRefusal } {
  if (input.voucherId === input.requesterId) return { ok: false, code: "self" };
  if (input.confirmationsThisWeek >= VOUCHES_PER_WEEK) return { ok: false, code: "weekly_limit" };
  if (input.pairConfirmationsThisWeek >= VOUCHES_PER_PAIR_PER_WEEK) return { ok: false, code: "pair_limit" };
  if (!isAnchored(input.voucherId, input.proofs)) return { ok: false, code: "voucher_unproven" };
  return { ok: true };
}
