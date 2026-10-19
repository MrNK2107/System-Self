import { and, asc, count, desc, eq, gt, inArray, isNotNull, isNull, lt, or } from "drizzle-orm";
import {
  exercises,
  personalRecords,
  workoutPlans,
  workoutSessions,
  type PlanDay,
  type WorkoutPlan,
  type Db,
  type WorkoutSession,
} from "@workspace/db";
import { DEFAULT_PLAN, WEEKDAYS, estimate1RM, type Weekday } from "@workspace/engine";
import { withUserLock, type Tx } from "./user-lock";

/** Weekday of a local `YYYY-MM-DD` date, from its UTC date parts (never the server's local zone). */
export function weekdayOf(date: string): Weekday {
  return WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()]!;
}

export function toPlanDto(p: WorkoutPlan) {
  return { id: p.id, name: p.name, goal: p.goal, days: p.days, isActive: p.isActive, createdAt: p.createdAt.toISOString() };
}

export function toSessionDto(s: WorkoutSession) {
  return {
    id: s.id,
    planId: s.planId,
    clientId: s.clientId,
    localDate: s.localDate,
    startedAt: s.startedAt.toISOString(),
    completedAt: s.completedAt ? s.completedAt.toISOString() : null,
    points: s.points,
  };
}

/** Exercises a user may reference: the seeded set (userId null) plus their own. */
export function visibleExercises(userId: string) {
  return or(isNull(exercises.userId), eq(exercises.userId, userId));
}

/** The ids in `ids` that are not visible to the user. */
export async function unknownExerciseIds(tx: Pick<Tx, "select">, userId: string, ids: string[]): Promise<string[]> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  const rows = await tx
    .select({ id: exercises.id })
    .from(exercises)
    .where(and(inArray(exercises.id, unique), visibleExercises(userId)));
  const known = new Set(rows.map((r) => r.id));
  return unique.filter((id) => !known.has(id));
}

export const planExerciseIds = (days: PlanDay[]): string[] => days.flatMap((d) => d.blocks.map((b) => b.exerciseId));

/** Creates the default plan (active) for a user with no plans yet. Call under the user lock. */
export async function ensureDefaultPlan(tx: Tx, userId: string): Promise<void> {
  const [row] = await tx.select({ n: count() }).from(workoutPlans).where(eq(workoutPlans.userId, userId));
  if ((row?.n ?? 0) > 0) return;
  await tx.insert(workoutPlans).values({
    userId,
    name: DEFAULT_PLAN.name,
    goal: DEFAULT_PLAN.goal,
    days: DEFAULT_PLAN.days,
    isActive: true,
  });
}

export async function listPlans(tx: Pick<Tx, "select">, userId: string): Promise<WorkoutPlan[]> {
  return tx.select().from(workoutPlans).where(eq(workoutPlans.userId, userId)).orderBy(asc(workoutPlans.createdAt), asc(workoutPlans.id));
}

export async function recentSessions(tx: Pick<Tx, "select">, userId: string, limit = 20): Promise<WorkoutSession[]> {
  return tx
    .select()
    .from(workoutSessions)
    .where(eq(workoutSessions.userId, userId))
    .orderBy(desc(workoutSessions.startedAt), desc(workoutSessions.id))
    .limit(limit);
}

export interface PrCandidate {
  exerciseId: string;
  value: number;
  reps: number;
  weight: number;
}

/** Best e1RM per Big 5 exercise among the completed sets of a session. */
export function bestBig5Lifts(
  sets: { exerciseId: string; reps: number; weight: number; completed: boolean }[],
  isBig5: (exerciseId: string) => boolean,
): PrCandidate[] {
  const best = new Map<string, PrCandidate>();
  for (const s of sets) {
    if (!s.completed || !isBig5(s.exerciseId)) continue;
    const value = estimate1RM(s.weight, s.reps);
    if (value <= 0) continue;
    const cur = best.get(s.exerciseId);
    if (!cur || value > cur.value) best.set(s.exerciseId, { exerciseId: s.exerciseId, value, reps: s.reps, weight: s.weight });
  }
  return [...best.values()];
}

/** Inserts or replaces records that the candidates beat; returns the new PRs. */
export async function applyPersonalRecords(
  tx: Tx,
  userId: string,
  candidates: PrCandidate[],
  nameOf: (exerciseId: string) => string,
  now: Date,
) {
  if (candidates.length === 0) return [];
  const existing = await tx
    .select()
    .from(personalRecords)
    .where(and(eq(personalRecords.userId, userId), inArray(personalRecords.exerciseId, candidates.map((c) => c.exerciseId))));
  const current = new Map(existing.map((r) => [r.exerciseId, r]));
  const newPrs: (PrCandidate & { name: string; previous: number | null; achievedAt: string })[] = [];
  for (const c of candidates) {
    const prior = current.get(c.exerciseId);
    if (prior && c.value <= prior.value) continue;
    await tx
      .insert(personalRecords)
      .values({ userId, exerciseId: c.exerciseId, value: c.value, reps: c.reps, weight: c.weight, achievedAt: now })
      .onConflictDoUpdate({
        target: [personalRecords.userId, personalRecords.exerciseId],
        set: { value: c.value, reps: c.reps, weight: c.weight, achievedAt: now },
      });
    newPrs.push({ ...c, name: nameOf(c.exerciseId), previous: prior ? prior.value : null, achievedAt: now.toISOString() });
  }
  return newPrs;
}

/** A session still open this long after it started was abandoned (the app was closed mid-workout, a crash, ...). */
export const ABANDON_GYM_SESSION_AFTER_MS = 12 * 3_600_000;

/**
 * Closes sessions left open for more than 12 h as abandoned: completed_at and abandoned_at are stamped and points
 * stay 0. Rank-neutral by design: nothing is scored, no gym_session log, PR or body-part points are written (the
 * finish path only scores a session the user completes). Each close runs under the user's lock, like
 * POST /gym/sessions/:id/complete, and re-checks the row there: a session completed meanwhile is left alone, and a
 * complete that comes after sees the abandoned row (409 session_abandoned) before writing anything. At most
 * `batch` x `maxBatches` sessions per call; the rest waits for the next tick. Returns the sessions closed.
 */
export async function closeAbandonedGymSessions(
  db: Db,
  now: Date,
  opts: { batch?: number; maxBatches?: number } = {},
): Promise<number> {
  const batch = opts.batch ?? 500;
  const maxBatches = opts.maxBatches ?? 5;
  const cutoff = new Date(now.getTime() - ABANDON_GYM_SESSION_AFTER_MS);
  const stale = () => and(isNull(workoutSessions.completedAt), lt(workoutSessions.startedAt, cutoff));
  let total = 0;
  let after: string | null = null;
  for (let i = 0; i < maxBatches; i++) {
    const candidates = await db
      .select({ id: workoutSessions.id, userId: workoutSessions.userId })
      .from(workoutSessions)
      .where(after === null ? stale() : and(stale(), gt(workoutSessions.id, after)))
      .orderBy(asc(workoutSessions.id))
      .limit(batch);
    for (const c of candidates) {
      const closed = await withUserLock(db, c.userId, (tx) =>
        tx
          .update(workoutSessions)
          .set({ completedAt: now, abandonedAt: now, points: 0 })
          .where(and(eq(workoutSessions.id, c.id), stale()))
          .returning({ id: workoutSessions.id }),
      );
      total += closed.length;
    }
    if (candidates.length < batch) break;
    after = candidates[candidates.length - 1]!.id;
  }
  return total;
}

/** Completed workouts, not abandoned ones. */
export const finishedSession = () => and(isNotNull(workoutSessions.completedAt), isNull(workoutSessions.abandonedAt));
