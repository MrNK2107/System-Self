import test, { after, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { closeTestDb, resetDb } from "@workspace/db/testing";
import { bodyPartScores, logs, performedSets, personalRecords, workoutSessions } from "@workspace/db";
import { addDays, localDate } from "@workspace/engine";
import {
  GymResponseSchema,
  PlanSchema,
  SessionCompleteResponseSchema,
  SessionSchema,
  SetSchema,
} from "@workspace/contracts";
import { app, auth, db, score, setup, skip, TZ, assertContract, assertStoredNoticesMatchContract } from "./game-test-helpers";

after(async () => {
  await closeTestDb();
});
afterEach(async () => {
  await assertStoredNoticesMatchContract();
});
beforeEach(async () => {
  if (db) await resetDb(db);
});

/** 12:00 local on the next date (strictly after today in TZ) whose weekday is `wd` (0 = Sunday). */
function nextWeekday(wd: number): Date {
  let d = addDays(localDate(new Date(), TZ), 1);
  while (new Date(`${d}T00:00:00Z`).getUTCDay() !== wd) d = addDays(d, 1);
  return new Date(`${d}T06:30:00Z`); // 12:00 in Asia/Kolkata (UTC+5:30)
}

const MON = 1;
const TUE = 2;

async function startSession(a: ReturnType<typeof app>, token: string, clientId: string) {
  const res = await request(a).post("/api/gym/sessions").set(auth(token)).send({ clientId });
  assert.equal(res.status, 201);
  assertContract(SessionSchema, res.body);
  return res.body.id as string;
}

async function addSet(
  a: ReturnType<typeof app>,
  token: string,
  sid: string,
  exerciseId: string,
  reps = 5,
  weight = 100,
  completed = true,
) {
  const res = await request(a)
    .post(`/api/gym/sessions/${sid}/sets`)
    .set(auth(token))
    .send({ exerciseId, reps, weight, completed });
  assert.equal(res.status, 201);
  assertContract(SetSchema, res.body);
  return res.body;
}

test("first GET creates the default plan", { skip }, async () => {
  const a = app();
  const { token } = await setup(a);
  const res = await request(a).get("/api/gym").set(auth(token));
  assert.equal(res.status, 200);
  assertContract(GymResponseSchema, res.body);
  assert.equal(res.body.plans.length, 1);
  const plan = res.body.plans[0];
  assert.equal(plan.name, "Starter Strength");
  assert.equal(plan.isActive, true);
  assert.equal(res.body.activePlanId, plan.id);
  assert.deepEqual(plan.days.map((d: { weekday: string }) => d.weekday), ["MON", "WED", "FRI"]);
  assert.equal(res.body.exercises.length, 20);
  assert.deepEqual(res.body.recentSessions, []);
  assert.deepEqual(res.body.personalRecords, []);
  const again = await request(a).get("/api/gym").set(auth(token));
  assert.equal(again.body.plans.length, 1);
});

test("complete MON session with all sets -> 17.3 points (BODY +4, the daily cap), gym_session log, PR for squat", { skip }, async () => {
  const monday = nextWeekday(MON);
  const a = app({ now: () => monday });
  const { token, id } = await setup(a);
  await request(a).get("/api/gym").set(auth(token));
  const sid = await startSession(a, token, "s-1");
  for (const ex of ["ex_squat", "ex_bench", "ex_row"]) {
    for (let i = 0; i < 3; i++) await addSet(a, token, sid, ex, 5, ex === "ex_squat" ? 100 : 60);
  }
  const res = await request(a).post(`/api/gym/sessions/${sid}/complete`).set(auth(token)).send({});
  assert.equal(res.status, 200);
  assertContract(SessionCompleteResponseSchema, res.body);
  assert.equal(res.body.points, 17.3);
  assert.equal(res.body.session.points, 17.3);
  assert.ok(res.body.session.completedAt);
  assert.deepEqual(res.body.byBodyPart, { quads: 5.1, chest: 5.1, back: 5.1 });
  assert.equal(res.body.results.length, 1);
  assert.equal(res.body.results[0].domain, "BODY");
  // 17.3 * headroom(20)=0.669 = 11.6, clipped to the 4 daily cap
  assert.equal(res.body.results[0].actualDelta, 4);
  assert.equal(res.body.results[0].streak, 1);
  const squat = res.body.newPrs.find((p: { exerciseId: string }) => p.exerciseId === "ex_squat");
  assert.ok(squat);
  assert.equal(squat.value, 116.67);
  assert.equal(squat.reps, 5);
  assert.equal(squat.weight, 100);

  const [log] = await db!.select().from(logs).where(eq(logs.userId, id));
  assert.equal(log!.domain, "BODY");
  assert.equal(log!.logType, "gym_session");
  assert.deepEqual(log!.data, { sessionId: sid, points: 17.3 });
  assert.equal(log!.clientId, `gym:${sid}`);

  const prs = await db!.select().from(personalRecords).where(eq(personalRecords.userId, id));
  assert.equal(prs.length, 3); // squat, bench and row are all Big 5
  assert.equal(res.body.newPrs.length, 3);
  const [quads] = await db!
    .select()
    .from(bodyPartScores)
    .where(and(eq(bodyPartScores.userId, id), eq(bodyPartScores.bodyPart, "quads")));
  assert.equal(quads!.points, 5.1);
  assert.equal((await score(id, "BODY")).streak, 1);

  const get = await request(a).get("/api/gym").set(auth(token));
  assertContract(GymResponseSchema, get.body);
  assert.equal(get.body.recentSessions.length, 1);
  assert.equal(get.body.bodyPartScores.length, 3);
});

test("PR is replaced only when greater", { skip }, async () => {
  const monday = nextWeekday(MON);
  const a = app({ now: () => monday });
  const { token } = await setup(a);
  const run = async (cid: string, weight: number) => {
    const sid = await startSession(a, token, cid);
    await addSet(a, token, sid, "ex_squat", 5, weight);
    return request(a).post(`/api/gym/sessions/${sid}/complete`).set(auth(token)).send({});
  };
  assert.equal((await run("p1", 100)).body.newPrs.length, 1);
  assert.equal((await run("p2", 90)).body.newPrs.length, 0);
  const third = await run("p3", 110);
  assert.equal(third.body.newPrs.length, 1);
  assert.equal(third.body.newPrs[0].weight, 110);
});

test("complete twice -> 409", { skip }, async () => {
  const monday = nextWeekday(MON);
  const a = app({ now: () => monday });
  const { token, id } = await setup(a);
  const sid = await startSession(a, token, "s-2");
  await addSet(a, token, sid, "ex_squat");
  const first = await request(a).post(`/api/gym/sessions/${sid}/complete`).set(auth(token)).send({});
  assert.equal(first.status, 200);
  const before = (await score(id, "BODY")).score;
  const second = await request(a).post(`/api/gym/sessions/${sid}/complete`).set(auth(token)).send({});
  assert.equal(second.status, 409);
  assert.equal(second.body.code, "already_completed");
  assert.equal((await score(id, "BODY")).score, before);
  const late = await request(a)
    .post(`/api/gym/sessions/${sid}/sets`)
    .set(auth(token))
    .send({ exerciseId: "ex_squat", reps: 5, weight: 100, completed: true });
  assert.equal(late.status, 409);
});

test("session on a day with no plan blocks -> 0 points, no score event", { skip }, async () => {
  const tuesday = nextWeekday(TUE);
  const a = app({ now: () => tuesday });
  const { token, id } = await setup(a);
  const sid = await startSession(a, token, "s-3");
  await addSet(a, token, sid, "ex_squat");
  const before = (await score(id, "BODY")).score;
  const res = await request(a).post(`/api/gym/sessions/${sid}/complete`).set(auth(token)).send({});
  assert.equal(res.status, 200);
  assert.equal(res.body.points, 0);
  assert.deepEqual(res.body.results, []);
  assert.equal((await score(id, "BODY")).score, before);
  assert.equal((await db!.select().from(logs).where(eq(logs.userId, id))).length, 0);
  const [s] = await db!.select().from(workoutSessions).where(eq(workoutSessions.id, sid));
  assert.ok(s!.completedAt);
});

test("plans: create validates exercises and limits; PATCH isActive deactivates others", { skip }, async () => {
  const a = app();
  const { token } = await setup(a);
  const get = await request(a).get("/api/gym").set(auth(token));
  const starter = get.body.plans[0];
  const day = { weekday: "TUE", blocks: [{ exerciseId: "ex_squat", sets: 3, repRange: "5", restSec: 90 }] };

  const bad = await request(a)
    .post("/api/gym/plans")
    .set(auth(token))
    .send({ name: "x", goal: "g", days: [{ weekday: "TUE", blocks: [{ ...day.blocks[0], exerciseId: "nope" }] }] });
  assert.equal(bad.status, 400);
  const tooMany = await request(a)
    .post("/api/gym/plans")
    .set(auth(token))
    .send({ name: "x", goal: "g", days: [{ weekday: "TUE", blocks: Array(13).fill(day.blocks[0]) }] });
  assert.equal(tooMany.status, 400);
  const eightDays = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"].map((w) => ({ ...day, weekday: w }));
  assert.equal(
    (await request(a).post("/api/gym/plans").set(auth(token)).send({ name: "x", goal: "g", days: eightDays })).status,
    400,
  );

  const ok = await request(a).post("/api/gym/plans").set(auth(token)).send({ name: "Mine", goal: "g", days: [day] });
  assert.equal(ok.status, 201);
  assertContract(PlanSchema, ok.body);
  assert.equal(ok.body.isActive, false);

  const patched = await request(a)
    .patch(`/api/gym/plans/${ok.body.id}`)
    .set(auth(token))
    .send({ isActive: true, name: "Mine 2" });
  assert.equal(patched.status, 200);
  assertContract(PlanSchema, patched.body);
  assert.equal(patched.body.name, "Mine 2");
  const after = await request(a).get("/api/gym").set(auth(token));
  assert.equal(after.body.activePlanId, ok.body.id);
  assert.equal(after.body.plans.filter((p: { isActive: boolean }) => p.isActive).length, 1);
  assert.equal(after.body.plans.find((p: { id: string }) => p.id === starter.id).isActive, false);

  assert.equal(
    (await request(a).patch("/api/gym/plans/00000000-0000-4000-8000-000000000000").set(auth(token)).send({ name: "z" })).status,
    404,
  );
});

test("sets validate input and ownership; sessions replay by clientId", { skip }, async () => {
  const a = app();
  const alice = await setup(a);
  const bob = await setup(a, { email: "bob@example.com", username: "bob_1" });
  const sid = await startSession(a, alice.token, "s-4");
  const replay = await request(a).post("/api/gym/sessions").set(auth(alice.token)).send({ clientId: "s-4" });
  assert.equal(replay.status, 200);
  assert.equal(replay.body.id, sid);
  const set = (token: string, body: object) =>
    request(a).post(`/api/gym/sessions/${sid}/sets`).set(auth(token)).send(body);
  assert.equal((await set(alice.token, { exerciseId: "ex_squat", reps: 201, weight: 1, completed: true })).status, 400);
  assert.equal((await set(alice.token, { exerciseId: "ex_squat", reps: 1, weight: 1001, completed: true })).status, 400);
  assert.equal((await set(alice.token, { exerciseId: "ghost", reps: 1, weight: 1, completed: true })).status, 400);
  assert.equal((await set(bob.token, { exerciseId: "ex_squat", reps: 1, weight: 1, completed: true })).status, 404);
  assert.equal(
    (await request(a).post(`/api/gym/sessions/${sid}/complete`).set(auth(bob.token)).send({})).status,
    404,
  );
  const s0 = await set(alice.token, { exerciseId: "ex_squat", reps: 1, weight: 1, completed: true });
  const s1 = await set(alice.token, { exerciseId: "ex_squat", reps: 1, weight: 1, completed: true });
  assert.equal(s0.body.setIndex, 0);
  assert.equal(s1.body.setIndex, 1);
});

test("a plan created before the first GET /gym becomes the active plan; no default is added", { skip }, async () => {
  const a = app();
  const { token } = await setup(a);
  const day = { weekday: "TUE", blocks: [{ exerciseId: "ex_squat", sets: 3, repRange: "5", restSec: 90 }] };
  const created = await request(a).post("/api/gym/plans").set(auth(token)).send({ name: "Mine", goal: "g", days: [day] });
  assert.equal(created.status, 201);
  assert.equal(created.body.isActive, true);
  const get = await request(a).get("/api/gym").set(auth(token));
  assert.deepEqual(get.body.plans.map((p: { id: string }) => p.id), [created.body.id]);
  assert.equal(get.body.activePlanId, created.body.id);
  const second = await request(a).post("/api/gym/plans").set(auth(token)).send({ name: "Two", goal: "g", days: [day] });
  assert.equal(second.body.isActive, false);
});

test("session and set create replay by clientId even with a different Idempotency-Key", { skip }, async () => {
  const a = app();
  const { token } = await setup(a);
  const session = (key: string) =>
    request(a).post("/api/gym/sessions").set(auth(token)).set("Idempotency-Key", key).send({ clientId: "sess-1" });
  const s1 = await session("h-1");
  const s2 = await session("h-2");
  assert.equal(s1.status, 201);
  assert.equal(s2.status, 200);
  assert.equal(s2.body.id, s1.body.id);
  const set = (key: string) =>
    request(a)
      .post(`/api/gym/sessions/${s1.body.id}/sets`)
      .set(auth(token))
      .set("Idempotency-Key", key)
      .send({ clientId: "set-1", exerciseId: "ex_squat", reps: 5, weight: 100, completed: true });
  const t1 = await set("h-3");
  const t2 = await set("h-4");
  assert.equal(t1.status, 201);
  assert.equal(t2.status, 200);
  assert.equal(t2.body.id, t1.body.id);
  assert.equal((await db!.select().from(performedSets).where(eq(performedSets.sessionId, s1.body.id))).length, 1);
});
