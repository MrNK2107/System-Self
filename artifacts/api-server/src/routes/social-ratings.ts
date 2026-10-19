import { Router, type IRouter } from "express";
import { and, eq, sql } from "drizzle-orm";
import { peerRatings, type Db } from "@workspace/db";
import { PEER_RATINGS_PER_WEEK, peerTenureMet } from "@workspace/engine";
import { PeerRatingRequestSchema } from "@workspace/contracts";
import { withIdempotency, type HandlerResult } from "../services/idempotency";
import { membershipOf } from "../services/clans";
import { raterWeekKey, ratingsGiven, ratingsUsed } from "../services/peer-ratings";
import { isBlockedEitherWay } from "../services/social";

// Anonymous weekly clan peer ratings (PRD 8 SOCIAL). The only reads are the rater's own ratings: there is no
// endpoint, field or notice that reveals who rated someone.

const err = (status: number, code: string, error: string): HandlerResult => ({ status, body: { error, code } });
const notEligible = () => err(403, "not_eligible", "You can rate clanmates who have been in your clan for 7 days");

export function socialRatingsRoutes(db: Db, clock: () => Date = () => new Date()): IRouter {
  const router = Router();

  /** What the viewer has given this (local ISO) week and how many ratings remain. */
  router.get("/clans/ratings/mine", async (req, res) => {
    res.json(await ratingsGiven(db, req.user!.id, clock()));
  });

  /**
   * Rates a clanmate 1-5 for the rater's current local ISO week. Runs under the rater's user lock, so the
   * count-then-insert limit check cannot race another rating of the same rater. Re-rating a clanmate already rated
   * this week replaces the value (no new slot).
   */
  router.post("/clans/ratings", async (req, res) => {
    const body = PeerRatingRequestSchema.parse(req.body ?? {});
    const me = req.user!.id;
    await withIdempotency(db, req, res, "POST /clans/ratings", async (tx) => {
      const now = clock();
      if (body.rateeUserId === me) return err(403, "self_target", "You cannot rate yourself");
      const mine = await membershipOf(tx, me);
      const theirs = await membershipOf(tx, body.rateeUserId);
      if (!mine || !theirs || mine.clanId !== theirs.clanId) return notEligible();
      if (!peerTenureMet(mine.joinedAt, now) || !peerTenureMet(theirs.joinedAt, now)) return notEligible();
      if (await isBlockedEitherWay(tx, me, body.rateeUserId)) return notEligible();

      const weekKey = await raterWeekKey(tx, me, now);
      const [existing] = await tx
        .select({ one: sql<number>`1` })
        .from(peerRatings)
        .where(and(eq(peerRatings.raterId, me), eq(peerRatings.rateeId, body.rateeUserId), eq(peerRatings.weekKey, weekKey)))
        .limit(1);
      if (!existing && (await ratingsUsed(tx, me, weekKey)) >= PEER_RATINGS_PER_WEEK) {
        return err(409, "rating_limit", `At most ${PEER_RATINGS_PER_WEEK} clanmates a week`);
      }
      await tx
        .insert(peerRatings)
        .values({ raterId: me, rateeId: body.rateeUserId, weekKey, rating: body.rating, createdAt: now, updatedAt: now })
        .onConflictDoUpdate({
          target: [peerRatings.raterId, peerRatings.rateeId, peerRatings.weekKey],
          set: { rating: body.rating, updatedAt: now },
        });
      return { status: 200, body: await ratingsGiven(tx, me, now) };
    });
  });

  return router;
}
