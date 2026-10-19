import { Router, type IRouter } from "express";
import { and, asc, count, eq, ne, sql } from "drizzle-orm";
import {
  bodyPartScores,
  exercises,
  gymCrowdReports,
  logs,
  performedSets,
  personalRecords,
  users,
  workoutPlans,
  workoutSessions,
  type Db,
} from "@workspace/db";
import {
  EXERCISE_FALLBACKS,
  EXERCISE_HOWTO,
  briefingBlocks,
  computeGymPoints,
  estimatedMinutes,
  localDate,
  localHour,
  quietHours,
  type CrowdLevel,
} from "@workspace/engine";
import {
  BriefingQuerySchema,
  CrowdReportRequestSchema,
  PlanCreateRequestSchema,
  PlanPatchRequestSchema,
  SessionCompleteRequestSchema,
  SessionCreateRequestSchema,
  SetCreateRequestSchema,
} from "@workspace/contracts";
import { withIdempotency, type HandlerResult } from "../services/idempotency";
import { rollOverDue } from "../services/rollover";
import { applyChanges } from "../services/scoring";
import { detectComeback, evaluateComeback } from "../services/comeback";
import { withUserLock, type Tx } from "../services/user-lock";
import {
  applyPersonalRecords,
  bestBig5Lifts,
  ensureDefaultPlan,
  listPlans,
  planExerciseIds,
  recentSessions,
  toPlanDto,
  toSessionDto,
  unknownExerciseIds,
  visibleExercises,
  weekdayOf,
} from "../services/gym";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const notFound = (what: string): HandlerResult => ({ status: 404, body: { error: `${what} not found` } });
const invalidExercise = (ids: string[]): HandlerResult => ({
  status: 400,
  body: { error: `Unknown exercise: ${ids.join(", ")}`, code: "invalid_exercise" },
});

async function userTimezone(tx: Pick<Tx, "select">, userId: string): Promise<string> {
  const [u] = await tx.select({ tz: users.timezone }).from(users).where(eq(users.id, userId)).limit(1);
  return u!.tz;
}

/** The user's own session row, or null (also for malformed ids). */
async function ownSession(tx: Tx, userId: string, id: string) {
  if (!UUID.test(id)) return null;
  const [s] = await tx
    .select()
    .from(workoutSessions)
    .where(and(eq(workoutSessions.id, id), eq(workoutSessions.userId, userId)))
    .limit(1);
  return s ?? null;
}

export function gymRoutes(db: Db, clock: () => Date = () => new Date()): IRouter {
  const router = Router();

  router.get("/gym", async (req, res) => {
    const userId = req.user!.id;
    const body = await withUserLock(db, userId, async (tx) => {
      await ensureDefaultPlan(tx, userId);
      const plans = await listPlans(tx, userId);
      const exerciseRows = await tx.select().from(exercises).where(visibleExercises(userId)).orderBy(asc(exercises.id));
      const sessions = await recentSessions(tx, userId, 20);
      const prs = await tx.select().from(personalRecords).where(eq(personalRecords.userId, userId));
      const parts = await tx.select().from(bodyPartScores).where(eq(bodyPartScores.userId, userId));
      return {
        exercises: exerciseRows,
        plans: plans.map(toPlanDto),
        activePlanId: plans.find((p) => p.isActive)?.id ?? null,
        recentSessions: sessions.map(toSessionDto),
        personalRecords: prs.map((r) => ({
          exerciseId: r.exerciseId,
          value: r.value,
          reps: r.reps,
          weight: r.weight,
          achievedAt: r.achievedAt.toISOString(),
        })),
        bodyPartScores: parts.map((p) => ({ bodyPart: p.bodyPart, points: p.points, updatedAt: p.updatedAt.toISOString() })),
      };
    });
    res.json(body);
  });

  /** Today's dungeon: the active plan's blocks for that weekday, or the beginner day, with fallbacks and how-to. */
  router.get("/gym/briefing", async (req, res) => {
    const query = BriefingQuerySchema.parse(req.query);
    const userId = req.user!.id;
    const body = await withUserLock(db, userId, async (tx) => {
      await ensureDefaultPlan(tx, userId);
      const date = query.date ?? localDate(clock(), await userTimezone(tx, userId));
      const [active] = await tx
        .select()
        .from(workoutPlans)
        .where(and(eq(workoutPlans.userId, userId), eq(workoutPlans.isActive, true)))
        .limit(1);
      const { source, blocks } = briefingBlocks(active?.days ?? [], weekdayOf(date));
      const rows = await tx.select().from(exercises).where(visibleExercises(userId));
      const nameOf = new Map(rows.map((e) => [e.id, e.name]));
      return {
        date,
        source,
        blocks: blocks.map((b) => ({
          exerciseId: b.exerciseId,
          name: nameOf.get(b.exerciseId) ?? b.exerciseId,
          sets: b.sets,
          repRange: b.repRange,
          restSec: b.restSec,
          howTo: EXERCISE_HOWTO[b.exerciseId] ?? "",
          fallbacks: (EXERCISE_FALLBACKS[b.exerciseId] ?? []).map((id) => ({ exerciseId: id, name: nameOf.get(id) ?? id })),
        })),
        estimatedMinutes: estimatedMinutes(blocks),
      };
    });
    res.json(body);
  });

  /** Scout report: how crowded the gym was. Weekday and hour are the user's local ones at report time. */
  router.post("/gym/crowd", async (req, res) => {
    const body = CrowdReportRequestSchema.parse(req.body ?? {});
    const userId = req.user!.id;
    await withIdempotency(db, req, res, "POST /gym/crowd", async (tx) => {
      const now = clock();
      const tz = await userTimezone(tx, userId);
      const weekday = new Date(`${localDate(now, tz)}T00:00:00Z`).getUTCDay();
      const hour = localHour(now, tz);
      let sessionId: string | null = null;
      if (body.sessionId) {
        const session = await ownSession(tx, userId, body.sessionId);
        if (!session) return notFound("Session");
        sessionId = session.id;
      }
      await tx.insert(gymCrowdReports).values({ userId, sessionId, level: body.level, weekday, hour });
      return { status: 201, body: { ok: true, weekday, hour } };
    }, { preferClientId: true });
  });

  router.get("/gym/quiet-hours", async (req, res) => {
    const userId = req.user!.id;
    const rows = await db
      .select({ weekday: gymCrowdReports.weekday, hour: gymCrowdReports.hour, level: gymCrowdReports.level })
      .from(gymCrowdReports)
      .where(eq(gymCrowdReports.userId, userId));
    res.json(quietHours(rows.map((r) => ({ ...r, level: r.level as CrowdLevel }))));
  });

  router.post("/gym/plans", async (req, res) => {
    const body = PlanCreateRequestSchema.parse(req.body ?? {});
    const userId = req.user!.id;
    await withIdempotency(db, req, res, "POST /gym/plans", async (tx) => {
      const unknown = await unknownExerciseIds(tx, userId, planExerciseIds(body.days));
      if (unknown.length > 0) return invalidExercise(unknown);
      // A user without an active plan (e.g. creating one before the first GET /gym) gets this one active.
      const [active] = await tx
        .select({ id: workoutPlans.id })
        .from(workoutPlans)
        .where(and(eq(workoutPlans.userId, userId), eq(workoutPlans.isActive, true)))
        .limit(1);
      const [plan] = await tx
        .insert(workoutPlans)
        .values({ userId, name: body.name, goal: body.goal, days: body.days, isActive: !active })
        .returning();
      return { status: 201, body: toPlanDto(plan!) };
    });
  });

  router.patch("/gym/plans/:id", async (req, res) => {
    const planId = String(req.params.id);
    const body = PlanPatchRequestSchema.parse(req.body ?? {});
    const userId = req.user!.id;
    await withIdempotency(db, req, res, `PATCH /gym/plans/${planId}`, async (tx) => {
      if (!UUID.test(planId)) return notFound("Plan");
      const [plan] = await tx
        .select()
        .from(workoutPlans)
        .where(and(eq(workoutPlans.id, planId), eq(workoutPlans.userId, userId)))
        .limit(1);
      if (!plan) return notFound("Plan");
      if (body.days) {
        const unknown = await unknownExerciseIds(tx, userId, planExerciseIds(body.days));
        if (unknown.length > 0) return invalidExercise(unknown);
      }
      if (body.isActive === true) {
        await tx
          .update(workoutPlans)
          .set({ isActive: false })
          .where(and(eq(workoutPlans.userId, userId), ne(workoutPlans.id, planId)));
      }
      const [updated] = await tx
        .update(workoutPlans)
        .set({
          ...(body.name !== undefined && { name: body.name }),
          ...(body.goal !== undefined && { goal: body.goal }),
          ...(body.days !== undefined && { days: body.days }),
          ...(body.isActive !== undefined && { isActive: body.isActive }),
        })
        .where(eq(workoutPlans.id, planId))
        .returning();
      return { status: 200, body: toPlanDto(updated!) };
    });
  });

  router.post("/gym/sessions", async (req, res) => {
    const body = SessionCreateRequestSchema.parse(req.body ?? {});
    const userId = req.user!.id;
    await withIdempotency(db, req, res, "POST /gym/sessions", async (tx) => {
      const now = clock();
      await rollOverDue(tx, userId, now);
      let planId: string | null = null;
      if (body.planId) {
        const [plan] = await tx
          .select({ id: workoutPlans.id })
          .from(workoutPlans)
          .where(and(eq(workoutPlans.id, body.planId), eq(workoutPlans.userId, userId)))
          .limit(1);
        if (!plan) return notFound("Plan");
        planId = plan.id;
      } else {
        const [active] = await tx
          .select({ id: workoutPlans.id })
          .from(workoutPlans)
          .where(and(eq(workoutPlans.userId, userId), eq(workoutPlans.isActive, true)))
          .limit(1);
        planId = active?.id ?? null;
      }
      // The clientId is the idempotency key; once its stored response is pruned, return the session.
      const [dup] = await tx
        .select()
        .from(workoutSessions)
        .where(and(eq(workoutSessions.userId, userId), eq(workoutSessions.clientId, body.clientId)))
        .limit(1);
      if (dup) return { status: 200, body: toSessionDto(dup) };
      const tz = await userTimezone(tx, userId);
      const [session] = await tx
        .insert(workoutSessions)
        .values({ userId, planId, startedAt: now, localDate: localDate(now, tz), clientId: body.clientId })
        .returning();
      return { status: 201, body: toSessionDto(session!) };
    }, { preferClientId: true });
  });

  router.post("/gym/sessions/:id/sets", async (req, res) => {
    const sessionId = String(req.params.id);
    const body = SetCreateRequestSchema.parse(req.body ?? {});
    const userId = req.user!.id;
    await withIdempotency(db, req, res, `POST /gym/sessions/${sessionId}/sets`, async (tx) => {
      await rollOverDue(tx, userId, clock());
      const session = await ownSession(tx, userId, sessionId);
      if (!session) return notFound("Session");
      if (session.completedAt) {
        return { status: 409, body: { error: "Session already completed", code: "already_completed" } };
      }
      const unknown = await unknownExerciseIds(tx, userId, [body.exerciseId]);
      if (unknown.length > 0) return invalidExercise(unknown);
      let setIndex = body.setIndex;
      if (setIndex === undefined) {
        const [row] = await tx
          .select({ n: count() })
          .from(performedSets)
          .where(and(eq(performedSets.sessionId, session.id), eq(performedSets.exerciseId, body.exerciseId)));
        setIndex = row?.n ?? 0;
      }
      const [set] = await tx
        .insert(performedSets)
        .values({
          sessionId: session.id,
          exerciseId: body.exerciseId,
          setIndex,
          reps: body.reps,
          weight: body.weight,
          completed: body.completed,
        })
        .returning();
      return {
        status: 201,
        body: {
          id: set!.id,
          sessionId: set!.sessionId,
          exerciseId: set!.exerciseId,
          setIndex: set!.setIndex,
          reps: set!.reps,
          weight: set!.weight,
          completed: set!.completed,
        },
      };
    }, { preferClientId: true });
  });

  router.post("/gym/sessions/:id/complete", async (req, res) => {
    const sessionId = String(req.params.id);
    SessionCompleteRequestSchema.parse(req.body ?? {});
    const userId = req.user!.id;
    await withIdempotency(db, req, res, `POST /gym/sessions/${sessionId}/complete`, async (tx) => {
      const now = clock();
      const today = localDate(now, await userTimezone(tx, userId));
      // Like POST /logs: roll the dates before the session's log date, apply it, then roll the rest.
      await rollOverDue(tx, userId, now, { before: today });
      const session = await ownSession(tx, userId, sessionId);
      if (!session) return notFound("Session");
      if (session.completedAt) {
        return { status: 409, body: { error: "Session already completed", code: "already_completed" } };
      }

      // The plan day is picked by the weekday of the session's own local date.
      const weekday = weekdayOf(session.localDate);
      let blocks: { exerciseId: string; sets: number }[] = [];
      if (session.planId) {
        const [plan] = await tx.select().from(workoutPlans).where(eq(workoutPlans.id, session.planId)).limit(1);
        blocks = plan?.days.find((d) => d.weekday === weekday)?.blocks ?? [];
      }
      const sets = await tx
        .select()
        .from(performedSets)
        .where(eq(performedSets.sessionId, session.id))
        .orderBy(asc(performedSets.id));
      const exerciseRows = await tx.select().from(exercises).where(visibleExercises(userId));
      const byId = new Map(exerciseRows.map((e) => [e.id, e]));

      const { totalPoints, byBodyPart } = computeGymPoints(sets, blocks, (id) => byId.get(id)?.primaryBodyPart);
      const newPrs = await applyPersonalRecords(
        tx,
        userId,
        bestBig5Lifts(sets, (id) => byId.get(id)?.isBig5 ?? false),
        (id) => byId.get(id)?.name ?? id,
        now,
      );

      const [done] = await tx
        .update(workoutSessions)
        .set({ completedAt: now, points: totalPoints })
        .where(and(eq(workoutSessions.id, session.id), sql`${workoutSessions.completedAt} is null`))
        .returning();
      if (!done) return { status: 409, body: { error: "Session already completed", code: "already_completed" } };

      let results: Awaited<ReturnType<typeof applyChanges>>["results"] = [];
      let notices: Awaited<ReturnType<typeof applyChanges>>["notices"] = [];
      // Judged against the previous activity, before the log below moves lastActivityDate.
      const comebackNotices = totalPoints > 0 ? await detectComeback(tx, userId, { activityDate: today, now }) : [];
      if (totalPoints > 0) {
        for (const [bodyPart, points] of Object.entries(byBodyPart)) {
          await tx
            .insert(bodyPartScores)
            .values({ userId, bodyPart, points, updatedAt: now })
            .onConflictDoUpdate({
              target: [bodyPartScores.userId, bodyPartScores.bodyPart],
              set: { points: sql`${bodyPartScores.points} + ${points}`, updatedAt: now },
            });
        }
        // The log row makes the session count as activity for "zero logs" and streak logic; its delta is
        // the gym change below, so it is inserted without a separate score change.
        await tx.insert(logs).values({
          userId,
          clientId: `gym:${session.id}`,
          domain: "BODY",
          logType: "gym_session",
          data: { sessionId: session.id, points: totalPoints },
          occurredAt: now,
          localDate: today,
        });
        const applied = await applyChanges(
          tx,
          userId,
          [{ domain: "BODY", delta: totalPoints, bonus: false, activity: true, reason: "gym", refId: session.id }],
          { localDate: today, now },
        );
        results = applied.results;
        const marks = (await evaluateComeback(tx, userId, now)).notices;
        notices = [...comebackNotices, ...applied.notices, ...marks];
      }
      await rollOverDue(tx, userId, now);
      return {
        status: 200,
        body: {
          session: toSessionDto(done),
          points: totalPoints,
          byBodyPart,
          newPrs,
          results,
          notices,
        },
      };
    });
  });

  return router;
}
