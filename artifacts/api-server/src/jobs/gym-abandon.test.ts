import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { eq, sql } from "drizzle-orm";
import { closeTestDb, resetDb } from "@workspace/db/testing";
import { bodyPartScores, logs, personalRecords, scoreEvents, workoutSessions } from "@workspace/db";
import { app, auth, db, score, setup, skip } from "../routes/game-test-helpers";
import { ABANDON_GYM_SESSION_AFTER_MS, closeAbandonedGymSessions } from "../services/gym";
import { runWorkerTick } from "./run-loop";
import { withUserLock } from "../services/user-lock";

after(async () => {
  await closeTestDb();
});
beforeEach(async () => {
  if (db) await resetDb(db);
});

const HOUR = 3_600_000;

/** Bounded wait until some backend is observably blocked on an advisory lock (no timing guess). */
async function waitForAdvisoryWaiter(timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const res = await db!.execute(sql`select count(*)::int as n from pg_locks where locktype = 'advisory' and not granted`);
    if ((res.rows[0] as { n: number }).n > 0) return;
    if (Date.now() > deadline) throw new Error("the sweep never waited on the user lock");
    await new Promise((r) => setTimeout(r, 20));
  }
}

async function openSession(a: ReturnType<typeof app>, token: string, clientId: string, startedAt: Date) {
  const res = await request(a).post("/api/gym/sessions").set(auth(token)).send({ clientId });
  assert.equal(res.status, 201);
  const id = res.body.id as string;
  const set = await request(a).post(`/api/gym/sessions/${id}/sets`).set(auth(token)).send({ exerciseId: "ex_squat", reps: 5, weight: 140, completed: true });
  assert.equal(set.status, 201);
  await db!.update(workoutSessions).set({ startedAt }).where(eq(workoutSessions.id, id));
  return id;
}

test("sessions open for more than 12 h are closed as abandoned: unscored, no log, no PR, no rank change", { skip }, async () => {
  assert.equal(ABANDON_GYM_SESSION_AFTER_MS, 12 * HOUR);
  const a = app();
  const { token, id: userId } = await setup(a);
  const now = new Date();
  const stale = await openSession(a, token, "stale-1", new Date(now.getTime() - 13 * HOUR));
  const fresh = await openSession(a, token, "fresh-1", new Date(now.getTime() - 11 * HOUR));
  const bodyBefore = await score(userId, "BODY");
  const eventsBefore = (await db!.select().from(scoreEvents).where(eq(scoreEvents.userId, userId))).length;

  assert.equal(await closeAbandonedGymSessions(db!, now), 1);
  const [s] = await db!.select().from(workoutSessions).where(eq(workoutSessions.id, stale));
  assert.equal(s!.abandonedAt?.getTime(), now.getTime());
  assert.equal(s!.completedAt?.getTime(), now.getTime(), "closed, so the app stops treating it as in progress");
  assert.equal(s!.points, 0);
  const [f] = await db!.select().from(workoutSessions).where(eq(workoutSessions.id, fresh));
  assert.equal(f!.completedAt, null);
  assert.equal(f!.abandonedAt, null);

  // Rank-neutral: nothing scored.
  assert.deepEqual(await score(userId, "BODY"), bodyBefore);
  assert.equal((await db!.select().from(scoreEvents).where(eq(scoreEvents.userId, userId))).length, eventsBefore);
  assert.equal((await db!.select().from(logs).where(eq(logs.logType, "gym_session"))).length, 0);
  assert.equal((await db!.select().from(personalRecords)).length, 0);
  assert.equal((await db!.select().from(bodyPartScores)).length, 0);

  // A late complete or set is refused with its own code; an idempotent re-run closes nothing more.
  const late = await request(a).post(`/api/gym/sessions/${stale}/complete`).set(auth(token)).send({});
  assert.equal(late.status, 409);
  assert.equal(late.body.code, "session_abandoned");
  const lateSet = await request(a).post(`/api/gym/sessions/${stale}/sets`).set(auth(token)).send({ exerciseId: "ex_squat", reps: 5, weight: 100, completed: true });
  assert.equal(lateSet.status, 409);
  assert.equal(lateSet.body.code, "session_abandoned");
  assert.equal(await closeAbandonedGymSessions(db!, now), 0);

  // Abandoned sessions do not count as completed workouts.
  const past = await request(a).get("/api/progress/past-self").set(auth(token));
  assert.equal(past.status, 200, JSON.stringify(past.body));
  assert.equal(past.body.gym.sessionsTotal, 0);
});

test("closing is bounded per call and runs in the worker tick", { skip }, async () => {
  const a = app();
  const { token } = await setup(a);
  const now = new Date();
  for (let i = 0; i < 3; i++) await openSession(a, token, `stale-${i}`, new Date(now.getTime() - 20 * HOUR));
  assert.equal(await closeAbandonedGymSessions(db!, now, { batch: 1, maxBatches: 2 }), 2);
  await runWorkerTick(db!, now, undefined, 200, async () => []);
  const open = (await db!.select().from(workoutSessions)).filter((s) => s.completedAt === null);
  assert.equal(open.length, 0);
});

test("the sweep takes each user's lock, so it serializes with /complete (which runs under it)", { skip }, async () => {
  const a = app();
  const { token, id: userId } = await setup(a);
  const now = new Date();
  const stale = await openSession(a, token, "stale-lock", new Date(now.getTime() - 13 * HOUR));
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  let locked!: () => void;
  const isLocked = new Promise<void>((r) => (locked = r));
  const holder = withUserLock(db!, userId, async () => {
    locked();
    await gate;
  });
  await isLocked;
  let swept: number | null = null;
  const sweep = closeAbandonedGymSessions(db!, now).then((n) => (swept = n));
  try {
    await waitForAdvisoryWaiter();
    assert.equal(swept, null, "blocked while the user's lock is held");
  } finally {
    release();
    await holder;
  }
  await sweep;
  assert.equal(swept, 1);
  const [s] = await db!.select().from(workoutSessions).where(eq(workoutSessions.id, stale));
  assert.ok(s!.abandonedAt);
});

test("a session completed while the sweep waited is left alone (re-checked under the lock)", { skip }, async () => {
  const a = app();
  const { token, id: userId } = await setup(a);
  const now = new Date();
  const stale = await openSession(a, token, "stale-done", new Date(now.getTime() - 13 * HOUR));
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  let locked!: () => void;
  const isLocked = new Promise<void>((r) => (locked = r));
  const holder = withUserLock(db!, userId, async (tx) => {
    locked();
    await gate;
    await tx.update(workoutSessions).set({ completedAt: now, points: 3 }).where(eq(workoutSessions.id, stale));
  });
  await isLocked;
  const sweep = closeAbandonedGymSessions(db!, now);
  try {
    await waitForAdvisoryWaiter();
  } finally {
    release();
    await holder;
  }
  assert.equal(await sweep, 0);
  const [s] = await db!.select().from(workoutSessions).where(eq(workoutSessions.id, stale));
  assert.equal(s!.abandonedAt, null);
  assert.equal(s!.points, 3);
});
