import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { dailySnapshots, domainScores, profiles, scoreEvents, userDayState, users, type Db } from "@workspace/db";
import {
  RANKED_DOMAINS,
  generateCodename,
  hiddenScore,
  localDate,
  type RankedDomain,
} from "@workspace/engine";
import { OnboardingRequestSchema } from "@workspace/contracts";
import { withIdempotency } from "../services/idempotency";
import { freePublicCodename } from "../services/social";
import { rolloverDueAt } from "../services/rollover";
import { buildGameState } from "../services/state";
import { INVALID_TIMEZONE, postgresKnowsTimezone, type TimezoneCheck } from "../services/timezone";

export function onboardingRoutes(db: Db, timezoneKnown: TimezoneCheck = postgresKnowsTimezone): IRouter {
  const router = Router();

  router.post("/onboarding", async (req, res) => {
    const body = OnboardingRequestSchema.parse(req.body);
    const userId = req.user!.id;
    if (!(await timezoneKnown(db, body.timezone))) {
      res.status(400).json(INVALID_TIMEZONE);
      return;
    }

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
        const profile = {
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
          homePathActive: body.homePathActive ?? false,
          lifeContext: body.lifeContext ?? "student",
          baselineScores: initial,
          baselineDate: today,
        };
        // The public codename is unique: a concurrent onboarding can take the chosen one between check and insert,
        // so retry the insert in a savepoint (a unique violation would otherwise abort the whole transaction).
        for (let attempt = 0; ; attempt++) {
          const publicCodename = await freePublicCodename(tx);
          try {
            await tx.transaction((sp) => sp.insert(profiles).values({ ...profile, publicCodename }));
            break;
          } catch (err) {
            const e = err as { code?: string; constraint?: string; cause?: { code?: string; constraint?: string } };
            const code = e.cause?.code ?? e.code;
            const constraint = e.cause?.constraint ?? e.constraint;
            if (code !== "23505" || constraint !== "profiles_public_codename_unique" || attempt >= 20) throw err;
          }
        }
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
        await tx.insert(userDayState).values({ userId, nextRolloverAt: rolloverDueAt(today, body.timezone) });
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
