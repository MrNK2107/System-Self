import type { ChangeSpec } from "./scoring";

/** Clan peer ratings (PRD 8 SOCIAL, PRD 15): up to 5 clanmates per ISO week, 1-5, anonymous. */
export const PEER_RATINGS_PER_WEEK = 5;
/** A ratee needs this many ratings in a week for the week to move their SOCIAL score. */
export const PEER_MIN_RATINGS = 4;
/** Rater and ratee must each have been in the clan this many days. */
export const PEER_TENURE_DAYS = 7;

const DAY_MS = 86_400_000;
const round1 = (n: number) => Math.round(n * 10) / 10;

export interface PeerRatingResult {
  count: number;
  /** Mean rating, to one decimal. */
  average: number;
  /** (average - 3) x 1.0, to one decimal: what the ratee is told. */
  delta: number;
  /** The SOCIAL change to apply (the unrounded average - 3); empty when the average is exactly 3. */
  changes: ChangeSpec[];
}

/** The week-close result for one ratee's ratings, or null below PEER_MIN_RATINGS (nothing happens). */
export function peerRatingResult(ratings: readonly number[]): PeerRatingResult | null {
  if (ratings.length < PEER_MIN_RATINGS) return null;
  const sum = ratings.reduce((a, b) => a + b, 0);
  const raw = sum / ratings.length - 3;
  return {
    count: ratings.length,
    average: round1(sum / ratings.length),
    delta: round1(raw) + 0,
    changes: sum === 3 * ratings.length ? [] : [{ domain: "SOCIAL", delta: raw, bonus: false, activity: false }],
  };
}

/** Joined at least PEER_TENURE_DAYS before `now`. */
export const peerTenureMet = (joinedAt: Date, now: Date): boolean => now.getTime() - joinedAt.getTime() >= PEER_TENURE_DAYS * DAY_MS;
