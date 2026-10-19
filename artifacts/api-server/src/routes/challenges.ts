import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq } from "drizzle-orm";
import { namedChallenges, users, type Db } from "@workspace/db";
import {
  CHALLENGE_MAX_OPEN,
  CHALLENGE_RESPOND_HOURS,
  ChallengeCreateRequestSchema,
  ChallengeRespondRequestSchema,
  type ChallengeListResponse,
} from "@workspace/contracts";
import { addDays, localDate, type RankedDomain } from "@workspace/engine";
import { z } from "zod";
import { proRequiredUnlessPro } from "../services/entitlements";
import { withIdempotency, type HandlerResult } from "../services/idempotency";
import { ensureRolledOver, rollOverDue } from "../services/rollover";
import { insertNotice } from "../services/scoring";
import {
  expirePending,
  listChallenges,
  lockSlots,
  mayChallenge,
  openBetween,
  openCount,
  postChallengeDispatch,
  challengeStartedLine,
  resolveOpponent,
  respondByFor,
  round2,
  sameClan,
  startAtAccept,
  toChallengeDtos,
} from "../services/challenges";
import { loadProjectionSubjects, projectUser } from "../services/projection";
import { track } from "../services/analytics";

const IdSchema = z.string().uuid();

const err = (status: number, code: string, error: string): HandlerResult => ({ status, body: { error, code } });
const notFound = () => err(404, "not_found", "Challenge not found");
const notEligible = () => err(403, "not_eligible", "You can only challenge a player you follow or a clanmate");
const notPending = () => err(409, "not_pending", "This challenge is no longer waiting for an answer");

export function challengesRoutes(db: Db, clock: () => Date = () => new Date()): IRouter {
  const router = Router();

  /** Issues a named challenge (PRO) to a followed user or a clanmate. */
  router.post("/challenges", async (req, res) => {
    const body = ChallengeCreateRequestSchema.parse(req.body ?? {});
    const me = req.user!.id;
    await withIdempotency(db, req, res, "POST /challenges", async (tx) => {
      const now = clock();
      const noPro = await proRequiredUnlessPro(tx, me, now);
      if (noPro) return noPro;
      const opp = await resolveOpponent(tx, me, body.opponent);
      if (!opp) return err(404, "not_found", "Player not found");
      if (opp.userId === me) return err(400, "self_challenge", "You cannot challenge yourself");
      // A blocked player and an unfollowed stranger answer the same, so nobody learns of a block.
      if (!(await mayChallenge(tx, me, opp.userId))) return notEligible();

      // The open counts and the insert must not interleave with another challenge touching either player.
      await lockSlots(tx, me, opp.userId);
      await expirePending(tx, now, me);
      await expirePending(tx, now, opp.userId);
      if (await openBetween(tx, me, opp.userId)) return err(409, "challenge_open", "A challenge between you is already open");
      if ((await openCount(tx, me)) >= CHALLENGE_MAX_OPEN) return err(409, "challenge_limit", `At most ${CHALLENGE_MAX_OPEN} open challenges`);
      if ((await openCount(tx, opp.userId)) >= CHALLENGE_MAX_OPEN) return err(409, "opponent_busy", "That player has too many open challenges");

      const [row] = await tx
        .insert(namedChallenges)
        .values({
          challengerId: me,
          opponentId: opp.userId,
          domain: body.domain,
          days: body.days,
          createdAt: now,
          respondBy: respondByFor(now, CHALLENGE_RESPOND_HOURS),
        })
        .returning();
      const subject = (await loadProjectionSubjects(tx, [me], now)).get(me);
      const handle = subject ? projectUser(subject, (await sameClan(tx, me, opp.userId)) ? "clanmate" : "public").handle : "OPERATOR";
      await insertNotice(tx, opp.userId, "challenge_received", { challengeId: row!.id, handle, domain: body.domain, days: body.days }, now);
      await track(tx, me, "challenge_created", { domain: body.domain, days: body.days });
      return { status: 201, body: (await toChallengeDtos(tx, me, [row!], now))[0]! };
    });
  });

  /** The viewer's open challenges and recent closed ones (both roles). */
  router.get("/challenges", async (req, res) => {
    const me = req.user!.id;
    const now = clock();
    await ensureRolledOver(db, me, now);
    const out: ChallengeListResponse = { items: await listChallenges(db, me, now) };
    res.json(out);
  });

  const respondRoute = (verb: "accept" | "ignore") => async (req: Request, res: Response) => {
    ChallengeRespondRequestSchema.parse(req.body ?? {});
    const id = IdSchema.safeParse(req.params.id);
    const me = req.user!.id;
    if (!id.success) return void res.status(404).json(notFound().body);
    await withIdempotency(db, req, res, `POST /challenges/${id.data}/${verb}`, async (tx) => {
      const now = clock();
      // Accepting captures start scores, so yesterday's decay is applied first (like every scoring read).
      if (verb === "accept") await rollOverDue(tx, me, now);
      const [c] = await tx
        .select()
        .from(namedChallenges)
        .where(and(eq(namedChallenges.id, id.data), eq(namedChallenges.opponentId, me)))
        .limit(1);
      if (!c) return notFound();
      if (c.status !== "pending") return notPending();
      if (verb === "ignore") {
        const [row] = await tx
          .update(namedChallenges)
          .set({ status: "ignored" })
          .where(and(eq(namedChallenges.id, c.id), eq(namedChallenges.status, "pending")))
          .returning();
        if (!row) return notPending();
        return { status: 200, body: (await toChallengeDtos(tx, me, [row], now))[0]! };
      }
      if (!c.challengerId) {
        await tx.update(namedChallenges).set({ status: "void", outcome: "void", resolvedAt: now }).where(eq(namedChallenges.id, c.id));
        return notPending();
      }
      if (c.respondBy.getTime() <= now.getTime()) {
        await tx.update(namedChallenges).set({ status: "ignored" }).where(and(eq(namedChallenges.id, c.id), eq(namedChallenges.status, "pending")));
        return err(409, "expired", "The 48 hours to answer have passed");
      }
      if (!(await mayChallenge(tx, c.challengerId, me))) {
        // The challenger unfollowed or a block appeared: the challenge is withdrawn. Nothing reveals which.
        await tx.update(namedChallenges).set({ status: "void", outcome: "void", resolvedAt: now }).where(eq(namedChallenges.id, c.id));
        return err(409, "not_pending", "This challenge was withdrawn");
      }
      const domain = c.domain as RankedDomain;
      const [mine] = await tx.select({ tz: users.timezone }).from(users).where(eq(users.id, me)).limit(1);
      // The window opens the local day after acceptance, so nobody is measured on a day already half played.
      const startDate = addDays(localDate(now, mine?.tz ?? "UTC"), 1);
      const [row] = await tx
        .update(namedChallenges)
        .set({
          status: "active",
          startDate,
          endDate: addDays(startDate, c.days - 1),
          // Each start is the player's own snapshot of the day before the window (null until it exists).
          challengerStart: await startAtAccept(tx, c.challengerId, domain, startDate),
          opponentStart: await startAtAccept(tx, me, domain, startDate),
        })
        .where(and(eq(namedChallenges.id, c.id), eq(namedChallenges.status, "pending")))
        .returning();
      if (!row) return notPending();
      const challengerId = c.challengerId;
      await postChallengeDispatch(tx, { challengerId, opponentId: me }, challengeStartedLine({ challengerId, opponentId: me }, domain, c.days), now);
      return { status: 200, body: (await toChallengeDtos(tx, me, [row], now))[0]! };
    });
  };
  router.post("/challenges/:id/accept", respondRoute("accept"));
  router.post("/challenges/:id/ignore", respondRoute("ignore"));

  return router;
}
