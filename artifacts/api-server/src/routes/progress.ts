import { Router, type IRouter } from "express";
import { and, count, eq, isNotNull } from "drizzle-orm";
import { domainScores, personalRecords, profiles, users, workoutSessions, type Db } from "@workspace/db";
import { RANKED_DOMAINS, localDate, type RankedDomain } from "@workspace/engine";
import { finishedSession } from "../services/gym";
import type { PastSelfResponse } from "@workspace/contracts";

type Scores = Record<RankedDomain, number>;

/** Reads a stored scores object into the five ranked domains (a missing one reads as 0). */
function toScores(raw: unknown): Scores {
  const src = (raw ?? {}) as Record<string, unknown>;
  return Object.fromEntries(RANKED_DOMAINS.map((d) => [d, typeof src[d] === "number" ? (src[d] as number) : 0])) as Scores;
}

export function progressRoutes(db: Db): IRouter {
  const router = Router();

  /**
   * "Past You": the profile's baseline (the onboarding scores; older accounts were backfilled from their first
   * daily snapshot) next to today's domain scores. Rollover's snapshot upserts never touch it. Read-only, and the
   * hidden score is never part of it.
   * gym.sessionsTotal = completed workout sessions; gym.exercisesWithPr = exercises with a personal record on file
   * (the table keeps one best per exercise, so it counts exercises, not individual improvements).
   */
  router.get("/progress/past-self", async (req, res) => {
    const userId = req.user!.id;
    const [who] = await db
      .select({
        tz: users.timezone,
        onboardedAt: profiles.onboardedAt,
        baselineScores: profiles.baselineScores,
        baselineDate: profiles.baselineDate,
      })
      .from(profiles)
      .innerJoin(users, eq(users.id, profiles.userId))
      .where(eq(profiles.userId, userId));
    if (!who) {
      res.status(409).json({ error: "Onboarding required", code: "not_onboarded" });
      return;
    }
    const currentRows = await db.select().from(domainScores).where(eq(domainScores.userId, userId));
    const current = toScores(Object.fromEntries(currentRows.map((r) => [r.domain, r.score])));
    const [sessions] = await db
      .select({ n: count() })
      .from(workoutSessions)
      .where(and(eq(workoutSessions.userId, userId), finishedSession()));
    const [prs] = await db.select({ n: count() }).from(personalRecords).where(eq(personalRecords.userId, userId));

    const onboardedOn = localDate(who.onboardedAt, who.tz);
    const baselineDate = who.baselineDate ?? onboardedOn;
    const body: PastSelfResponse = {
      baselineDate,
      label: baselineDate === onboardedOn ? "DAY 1" : `SINCE ${baselineDate}`,
      baseline: who.baselineScores ? toScores(who.baselineScores) : current,
      current,
      gym: { sessionsTotal: sessions?.n ?? 0, exercisesWithPr: prs?.n ?? 0 },
    };
    res.json(body);
  });

  return router;
}
