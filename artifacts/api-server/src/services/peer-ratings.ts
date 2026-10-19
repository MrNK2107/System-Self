import { and, eq, sql } from "drizzle-orm";
import { clanMembers, peerRatingWeeks, peerRatings, users } from "@workspace/db";
import { PEER_MIN_RATINGS, PEER_RATINGS_PER_WEEK, isLastDayOfIsoWeek, isoWeekKey, localDate, peerRatingResult } from "@workspace/engine";
import { FORMER_OPERATOR_HANDLE, type Notice, type PeerRatingsMine } from "@workspace/contracts";
import { applyChanges, insertNotice } from "./scoring";
import { membershipOf } from "./clans";
import { userTimezone } from "./finance";
import type { Tx } from "./user-lock";

type Reader = Pick<Tx, "select">;

/** The ISO week (YYYY-Www) of the rater's own local date: the key a rating is stored under. */
export async function raterWeekKey(tx: Reader, userId: string, now: Date): Promise<string> {
  return isoWeekKey(localDate(now, await userTimezone(tx, userId)));
}

/**
 * What `userId` has given in their current local ISO week. A clanmate is named by username; a ratee who is no
 * longer in the viewer's clan reads FORMER OPERATOR (a username never outlives the membership). Only ratings the
 * viewer gave: there is no read of ratings received.
 */
export async function ratingsGiven(tx: Reader, userId: string, now: Date): Promise<PeerRatingsMine> {
  const weekKey = await raterWeekKey(tx, userId, now);
  const mine = await membershipOf(tx, userId);
  const rows = await tx
    .select({ rating: peerRatings.rating, username: users.username, clanId: clanMembers.clanId })
    .from(peerRatings)
    .innerJoin(users, eq(users.id, peerRatings.rateeId))
    .leftJoin(clanMembers, eq(clanMembers.userId, peerRatings.rateeId))
    .where(and(eq(peerRatings.raterId, userId), eq(peerRatings.weekKey, weekKey)))
    .orderBy(peerRatings.createdAt, users.username);
  return {
    weekKey,
    given: rows.map((r) => ({
      rateeHandle: mine && r.clanId === mine.clanId ? r.username : FORMER_OPERATOR_HANDLE,
      rating: r.rating,
    })),
    remaining: Math.max(0, PEER_RATINGS_PER_WEEK - rows.length),
  };
}

/** Number of distinct clanmates `userId` has rated under `weekKey`. */
export async function ratingsUsed(tx: Reader, userId: string, weekKey: string): Promise<number> {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(peerRatings)
    .where(and(eq(peerRatings.raterId, userId), eq(peerRatings.weekKey, weekKey)));
  return row?.n ?? 0;
}

/**
 * Rollover hook for the last local date of an ISO week: the ratee's peer-rating week close. Ratings whose weekKey
 * (the rater's local ISO week) is this week count, whoever gave them and wherever the rater is now (a rater who left
 * the clan mid-week still counts). With at least PEER_MIN_RATINGS (4), SOCIAL moves by (average - 3) x 1.0 (reason
 * `peer_rating`, no bonus, not activity) and the ratee gets a `peer_rating_result` notice with aggregates only. The
 * peer_rating_weeks row (primary key user + ISO week) makes it exactly once per week. Must run inside withUserLock.
 */
export async function evaluatePeerRatingsWeek(tx: Tx, userId: string, date: string, now: Date): Promise<Notice[]> {
  if (!isLastDayOfIsoWeek(date)) return [];
  const weekKey = isoWeekKey(date);
  const rows = await tx
    .select({ rating: peerRatings.rating })
    .from(peerRatings)
    .where(and(eq(peerRatings.rateeId, userId), eq(peerRatings.weekKey, weekKey)));
  if (rows.length < PEER_MIN_RATINGS) return [];
  const result = peerRatingResult(rows.map((r) => r.rating))!;
  const claimed = await tx
    .insert(peerRatingWeeks)
    .values({ userId, weekKey, evaluatedOn: date, ratingCount: result.count, average: result.average, createdAt: now })
    .onConflictDoNothing()
    .returning({ weekKey: peerRatingWeeks.weekKey });
  if (claimed.length === 0) return [];

  const applied = await applyChanges(
    tx,
    userId,
    result.changes.map((c) => ({ ...c, reason: "peer_rating" as const, refId: weekKey })),
    { localDate: date, now },
  );
  const delta = Math.round(applied.results.reduce((sum, r) => sum + r.actualDelta, 0) * 10) / 10 + 0;
  await tx
    .update(peerRatingWeeks)
    .set({ delta })
    .where(and(eq(peerRatingWeeks.userId, userId), eq(peerRatingWeeks.weekKey, weekKey)));
  const notice = await insertNotice(tx, userId, "peer_rating_result", { weekKey, average: result.average, delta }, now);
  return [...applied.notices, notice];
}
