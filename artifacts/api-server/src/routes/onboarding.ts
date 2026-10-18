import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { dailySnapshots, domainScores, profiles, scoreEvents, userDayState, users, type Db } from "@workspace/db";
import {
  RANKED_DOMAINS,
  endOfLocalDay,
  generateCodename,
  hiddenScore,
  localDate,
  type RankedDomain,
} from "@workspace/engine";
import { OnboardingRequestSchema } from "@workspace/contracts";
import { withIdempotency } from "../services/idempotency";
import { buildGameState } from "../services/state";

export function onboardingRoutes(db: Db): IRouter {
  const router = Router();

  router.post("/onboarding", async (req, res) => {
    const body = OnboardingRequestSchema.parse(req.body);
    const userId = req.user!.id;

    await withIdempotency(db, req, res, "POST /onboarding", async (tx) => {
      const now = new Date();
      {
        const [existing] = await tx.select({ id: profiles.userId }).from(profiles).where(eq(profiles.userId, userId));
        if (existing) {
          return { status: 409, body: { error: "Already onboarded", code: "already_onboarded" } };
        }

        const today = localDate(now, body.timezone);
        const initial = Object.fromEntries(RANKED_DOMAINS.map((d) => [d, body.ratings[d] * 4])) as Record<
          RankedDomain,
          number
        >;

        await tx.update(users).set({ timezone: body.timezone, updatedAt: now }).where(eq(users.id, userId));
        await tx.insert(profiles).values({
          userId,
          identitySetting: body.identitySetting,
          primaryGoal: body.primaryGoal,
          biggestWeakness: body.biggestWeakness,
          stoppedBefore: body.stoppedBefore ?? null,
          morningTime: body.morningTime,
          nightlyTime: body.nightlyTime,
          rank: "E",
          rankSince: now,
          codename: generateCodename("E"),
          onboardedAt: now,
          onboardingRatings: body.ratings,
        });
        await tx
          .insert(domainScores)
          .values(
            RANKED_DOMAINS.map((d) => ({ userId, domain: d, score: initial[d], streak: 0, lastLogDate: null, updatedAt: now })),
          );
        await tx.insert(scoreEvents).values(
          RANKED_DOMAINS.map((d) => ({
            userId,
            domain: d,
            delta: initial[d],
            actualDelta: initial[d],
            reason: "onboarding",
            localDate: today,
            createdAt: now,
          })),
        );
        await tx.insert(userDayState).values({ userId, nextRolloverAt: endOfLocalDay(today, body.timezone) });
        await tx.insert(dailySnapshots).values({
          userId,
          localDate: today,
          scores: initial,
          hidden: hiddenScore(initial, 1.0),
          rank: "E",
        });
      }
      return { status: 201, body: await buildGameState(tx, userId, now) };
    });
  });

  return router;
}
