import { Router, type IRouter } from "express";
import { and, asc, count, eq, isNotNull } from "drizzle-orm";
import { dailySnapshots, domainScores, personalRecords, profiles, users, workoutSessions, type Db } from "@workspace/db";
import { RANKED_DOMAINS, localDate, type RankedDomain } from "@workspace/engine";
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
   * "Past You": the earliest daily snapshot (written at onboarding; the first one on file for older accounts)
   * next to today's domain scores. Read-only, and the hidden score is never part of it.
   * gym.sessionsTotal = completed workout sessions; gym.exercisesWithPr = exercises with a personal record on file
   * (the table keeps one best per exercise, so it counts exercises, not individual improvements).
   */
  router.get("/progress/past-self", async (req, res) => {
    const userId = req.user!.id;
    const [who] = await db
      .select({ tz: users.timezone, onboardedAt: profiles.onboardedAt })
      .from(profiles)
      .innerJoin(users, eq(users.id, profiles.userId))
      .where(eq(profiles.userId, userId));
    if (!who) {
      res.status(409).json({ error: "Onboarding required", code: "not_onboarded" });
      return;
    }
    const [first] = await db
      .select({ localDate: dailySnapshots.localDate, scores: dailySnapshots.scores })
      .from(dailySnapshots)
      .where(eq(dailySnapshots.userId, userId))
      .orderBy(asc(dailySnapshots.localDate))
      .limit(1);
    const currentRows = await db.select().from(domainScores).where(eq(domainScores.userId, userId));
    const current = toScores(Object.fromEntries(currentRows.map((r) => [r.domain, r.score])));
    const [sessions] = await db
      .select({ n: count() })
      .from(workoutSessions)
      .where(and(eq(workoutSessions.userId, userId), isNotNull(workoutSessions.completedAt)));
    const [prs] = await db.select({ n: count() }).from(personalRecords).where(eq(personalRecords.userId, userId));

    const onboardedOn = localDate(who.onboardedAt, who.tz);
    const baselineDate = first?.localDate ?? onboardedOn;
    const body: PastSelfResponse = {
      baselineDate,
      label: baselineDate === onboardedOn ? "DAY 1" : `SINCE ${baselineDate}`,
      baseline: first ? toScores(first.scores) : current,
      current,
      gym: { sessionsTotal: sessions?.n ?? 0, exercisesWithPr: prs?.n ?? 0 },
    };
    res.json(body);
  });

  return router;
}
