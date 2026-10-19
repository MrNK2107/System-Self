import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { eq } from "drizzle-orm";
import { closeTestDb, resetDb } from "@workspace/db/testing";
import {
  analyticsEvents,
  comebacks,
  dailySnapshots,
  logs,
  personalRecords,
  quests,
  users,
  workoutSessions,
} from "@workspace/db";
import { addDays, localDate } from "@workspace/engine";
import { AdherenceMetricsResponseSchema, GameStateSchema, PastSelfResponseSchema } from "@workspace/contracts";
import { TZ, app, assertContract, auth, db, setup, skip } from "./game-test-helpers";

after(async () => {
  await closeTestDb();
});
beforeEach(async () => {
  if (db) await resetDb(db);
});

const DOMAINS = ["BODY", "MIND", "WEALTH", "SOCIAL", "DISCIPLINE"] as const;

test("past-self returns DAY 1 baseline from onboarding", { skip }, async () => {
  const a = app();
  const { token, id } = await setup(a);
  const state = await request(a).get("/api/state").set(auth(token));
  assertContract(GameStateSchema, state.body);
  const onboarded = Object.fromEntries(state.body.scores.map((s: { domain: string; score: number }) => [s.domain, s.score]));

  const first = await request(a).get("/api/progress/past-self").set(auth(token));
  assert.equal(first.status, 200);
  assertContract(PastSelfResponseSchema, first.body);
  assert.equal(first.body.label, "DAY 1");
  assert.equal(first.body.baselineDate, localDate(new Date(), TZ));
  assert.deepEqual(first.body.baseline, onboarded);
  assert.deepEqual(first.body.current, onboarded);
  assert.deepEqual(first.body.gym, { sessionsTotal: 0, prsImproved: 0 });
  assert.equal(JSON.stringify(first.body).includes("hidden"), false);

  // Logging moves current, never the baseline.
  const log = await request(a)
    .post("/api/logs")
    .set(auth(token))
    .send({ clientId: "ps-1", domain: "BODY", logType: "workout", occurredAt: new Date().toISOString() });
  assert.equal(log.status, 201);
  const moved = await request(a).get("/api/progress/past-self").set(auth(token));
  assertContract(PastSelfResponseSchema, moved.body);
  assert.deepEqual(moved.body.baseline, onboarded);
  assert.ok(moved.body.current.BODY > onboarded.BODY, "current BODY moved");
  for (const d of DOMAINS) if (d !== "BODY") assert.equal(moved.body.current[d], onboarded[d]);

  // An earlier snapshot (an existing user's first one) becomes the baseline and the label reads SINCE.
  const earlier = addDays(localDate(new Date(), TZ), -10);
  await db!.insert(dailySnapshots).values({
    userId: id,
    localDate: earlier,
    scores: { BODY: 1, MIND: 2, WEALTH: 3, SOCIAL: 4, DISCIPLINE: 5 },
    hidden: 0.5,
    rank: "E",
  });
  const since = await request(a).get("/api/progress/past-self").set(auth(token));
  assertContract(PastSelfResponseSchema, since.body);
  assert.equal(since.body.label, `SINCE ${earlier}`);
  assert.deepEqual(since.body.baseline, { BODY: 1, MIND: 2, WEALTH: 3, SOCIAL: 4, DISCIPLINE: 5 });
});

test("past-self counts completed sessions and exercises with a PR", { skip }, async () => {
  const a = app();
  const { token, id } = await setup(a);
  const t = new Date();
  await db!.insert(workoutSessions).values([
    { userId: id, startedAt: t, completedAt: t, localDate: localDate(t, TZ), clientId: "w1" },
    { userId: id, startedAt: t, completedAt: null, localDate: localDate(t, TZ), clientId: "w2" },
  ]);
  await db!.insert(personalRecords).values({ userId: id, exerciseId: "bench", value: 100, reps: 5, weight: 90, achievedAt: t });
  const res = await request(a).get("/api/progress/past-self").set(auth(token));
  assert.deepEqual(res.body.gym, { sessionsTotal: 1, prsImproved: 1 });
});

test("past-self requires auth and onboarding", { skip }, async () => {
  const a = app();
  assert.equal((await request(a).get("/api/progress/past-self")).status, 401);
  const reg = await request(a)
    .post("/api/auth/register")
    .send({ email: "n@example.com", password: "correct horse battery", username: "newbie_1", birthYear: 1990, acceptTerms: true, timezone: TZ });
  const res = await request(a).get("/api/progress/past-self").set(auth(reg.body.accessToken));
  assert.equal(res.status, 409);
  assert.equal(res.body.code, "not_onboarded");
});

// --- admin metrics ----------------------------------------------------------

// A fixed Monday, 12:00 in Asia/Kolkata: the metrics window is cut from this injected clock.
const NOW = new Date("2026-06-08T06:30:00Z");
const DAY = 86_400_000;
const metricsApp = () => app({ now: () => NOW });
const metrics = (a: ReturnType<typeof app>, token: string, q = "") => request(a).get(`/api/admin/metrics/adherence${q}`).set(auth(token));

async function makeAdmin(a: ReturnType<typeof app>) {
  const s = await setup(a, { email: "root@example.com", username: "root_1" });
  await db!.update(users).set({ role: "admin" }).where(eq(users.id, s.id));
  return s;
}

const event = (userId: string | null, name: string, daysAgo: number) => ({
  userId,
  name,
  props: {},
  createdAt: new Date(NOW.getTime() - daysAgo * DAY),
});

test("metrics requires admin", { skip }, async () => {
  const a = metricsApp();
  assert.equal((await request(a).get("/api/admin/metrics/adherence")).status, 401);
  const { token } = await setup(a);
  assert.equal((await metrics(a, token)).status, 403);
  const admin = await makeAdmin(a);
  assert.equal((await metrics(a, admin.token, "?days=0")).status, 400);
  assert.equal((await metrics(a, admin.token)).status, 200);
});

test("metrics computes floorUptake from analytics events", { skip }, async () => {
  const a = metricsApp();
  const { id } = await setup(a);
  const admin = await makeAdmin(a);
  const empty = await metrics(a, admin.token);
  assertContract(AdherenceMetricsResponseSchema, empty.body);
  assert.deepEqual(empty.body, { floorOffered: 0, floorCompleted: 0, floorUptake: 0, secondVisitRate: 0, comebackRate: 0, deferralsPerActiveUser: 0 });

  await db!.insert(analyticsEvents).values([
    event(id, "floor_offered", 1),
    event(id, "floor_offered", 2),
    event(id, "floor_offered", 3),
    event(id, "floor_offered", 5),
    event(id, "floor_completed", 2),
    event(id, "floor_offered", 40), // outside the 30-day window
    event(id, "floor_completed", 41),
    event(id, "floor_completed", 45),
  ]);
  const res = await metrics(a, admin.token);
  assertContract(AdherenceMetricsResponseSchema, res.body);
  assert.equal(res.body.floorOffered, 4);
  assert.equal(res.body.floorCompleted, 1);
  assert.equal(res.body.floorUptake, 0.25);
  const wide = await metrics(a, admin.token, "?days=60");
  assert.equal(wide.body.floorOffered, 5);
  assert.equal(wide.body.floorCompleted, 3);
  assert.equal(wide.body.floorUptake, 0.6);
});

test("metrics: secondVisitRate, comebackRate and deferralsPerActiveUser", { skip }, async () => {
  const a = metricsApp();
  const u1 = await setup(a, { email: "u1@example.com", username: "u_one" });
  const u2 = await setup(a, { email: "u2@example.com", username: "u_two" });
  const u3 = await setup(a, { email: "u3@example.com", username: "u_three" });
  const admin = await makeAdmin(a);
  const today = localDate(NOW, TZ);
  const day = (n: number) => addDays(today, -n);
  const log = (userId: string, n: number, logType: string, clientId: string, domain = "BODY") => ({
    userId,
    clientId,
    domain,
    logType,
    occurredAt: new Date(NOW.getTime() - n * DAY),
    localDate: day(n),
  });
  await db!.insert(logs).values([
    // u1: a session, 6 empty days, a return session, then another BODY log 3 days later: a second visit.
    log(u1.id, 20, "gym_session", "a1"),
    log(u1.id, 13, "gym_session", "a2"),
    log(u1.id, 10, "workout", "a3"),
    // u2: returns after a gap and never trains again within 7 days (a MIND log does not count).
    log(u2.id, 20, "home_session", "b1"),
    log(u2.id, 12, "floor_session", "b2"),
    log(u2.id, 11, "journal", "b3", "MIND"),
    // u3: no gap at all, so no return session.
    log(u3.id, 5, "gym_session", "c1"),
    log(u3.id, 3, "gym_session", "c2"),
  ]);
  await db!.insert(comebacks).values([
    { userId: u1.id, startedOn: day(13), gapDays: 6, completedAt: NOW },
    { userId: u2.id, startedOn: day(12), gapDays: 7, completedAt: null },
    { userId: u2.id, startedOn: day(100), gapDays: 9, completedAt: NOW }, // outside the window
  ]);
  const quest = (userId: string, title: string, n: number, reason: string | null) => ({
    userId,
    type: "daily",
    title,
    description: "d",
    domain: "BODY",
    status: "refused",
    expiresAt: NOW,
    refusalReason: reason,
    resolvedLocalDate: day(n),
  });
  await db!.insert(quests).values([
    quest(u1.id, "r1", 2, "tired"),
    quest(u2.id, "r2", 3, "busy"),
    quest(u2.id, "r3", 4, null), // no reason: not a deferral
    quest(u2.id, "r4", 90, "old"), // outside the window
  ]);

  const res = await metrics(a, admin.token);
  assertContract(AdherenceMetricsResponseSchema, res.body);
  // Return sessions: u1 (day 13) and u2 (day 12). Only u1 trained again within 7 days.
  assert.equal(res.body.secondVisitRate, 0.5);
  assert.equal(res.body.comebackRate, 0.5);
  // 2 deferrals / 3 users who logged in the window (u1, u2, u3).
  assert.equal(res.body.deferralsPerActiveUser, 2 / 3);
});
