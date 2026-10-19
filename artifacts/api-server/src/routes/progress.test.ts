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
  profiles,
  quests,
  users,
  workoutSessions,
} from "@workspace/db";
import { addDays, localDate } from "@workspace/engine";
import { AdherenceMetricsResponseSchema, GameStateSchema, PastSelfResponseSchema } from "@workspace/contracts";
import { ensureRolledOver } from "../services/rollover";
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
  assert.deepEqual(first.body.gym, { sessionsTotal: 0, exercisesWithPr: 0 });
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

  // A backfilled older account: the baseline is the profile's stored one, and the label reads SINCE.
  const earlier = addDays(localDate(new Date(), TZ), -10);
  await db!
    .update(profiles)
    .set({ baselineScores: { BODY: 1, MIND: 2, WEALTH: 3, SOCIAL: 4, DISCIPLINE: 5 }, baselineDate: earlier })
    .where(eq(profiles.userId, id));
  const since = await request(a).get("/api/progress/past-self").set(auth(token));
  assertContract(PastSelfResponseSchema, since.body);
  assert.equal(since.body.label, `SINCE ${earlier}`);
  assert.equal(since.body.baselineDate, earlier);
  assert.deepEqual(since.body.baseline, { BODY: 1, MIND: 2, WEALTH: 3, SOCIAL: 4, DISCIPLINE: 5 });
});

test("past-self baseline survives the rollover of the onboarding date", { skip }, async () => {
  const a = app();
  const { token, id } = await setup(a);
  const state = await request(a).get("/api/state").set(auth(token));
  const onboarded = Object.fromEntries(state.body.scores.map((s: { domain: string; score: number }) => [s.domain, s.score]));
  const onboardedOn = localDate(new Date(), TZ);

  // A day-1 log moves BODY; rolling day 1 over upserts its snapshot with the moved scores.
  const log = await request(a)
    .post("/api/logs")
    .set(auth(token))
    .send({ clientId: "ps-roll", domain: "BODY", logType: "workout", occurredAt: new Date().toISOString() });
  assert.equal(log.status, 201);
  await ensureRolledOver(db!, id, new Date(Date.now() + 2 * 86_400_000));
  const [snap] = await db!.select().from(dailySnapshots).where(eq(dailySnapshots.localDate, onboardedOn));
  assert.notDeepEqual(snap!.scores, onboarded, "the day-1 snapshot was overwritten by the rollover");

  const res = await request(a).get("/api/progress/past-self").set(auth(token));
  assert.equal(res.status, 200);
  assertContract(PastSelfResponseSchema, res.body);
  assert.equal(res.body.label, "DAY 1");
  assert.equal(res.body.baselineDate, onboardedOn);
  assert.deepEqual(res.body.baseline, onboarded);
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
  assert.deepEqual(res.body.gym, { sessionsTotal: 1, exercisesWithPr: 1 });
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

test("secondVisitRate edges: 5 empty days is a return, 4 is not; first session, pre-window and censored returns excluded; day 8 is too late", { skip }, async () => {
  const a = metricsApp();
  const names = ["a", "b", "c", "d", "e", "f"];
  const us: Record<string, string> = {};
  for (const n of names) us[n] = (await setup(a, { email: `${n}@example.com`, username: `edge_${n}` })).id;
  const admin = await makeAdmin(a);
  const day = (n: number) => addDays(localDate(NOW, TZ), -n);
  let k = 0;
  const log = (who: string, n: number, logType = "gym_session") => ({
    userId: us[who]!,
    clientId: `e${k++}`,
    domain: "BODY",
    logType,
    occurredAt: new Date(NOW.getTime() - n * DAY),
    localDate: day(n),
  });
  await db!.insert(logs).values([
    // a: exactly 5 empty days (30 -> 24) is a return; a BODY log 2 days later is a second visit.
    log("a", 30), log("a", 24), log("a", 22, "workout"),
    // b: only 4 empty days (30 -> 25): not a return.
    log("b", 30), log("b", 25),
    // c: a first-ever session is not a return.
    log("c", 20),
    // d: the return (day 40) is before the 30-day window.
    log("d", 50), log("d", 40),
    // e: a return (day 20) whose next BODY log is on day 12, 8 days later: not a second visit.
    log("e", 30), log("e", 20), log("e", 12, "workout"),
    // f: a return on day 3 is too recent to judge (needs 7 days of follow-up): censored out.
    log("f", 30), log("f", 3),
  ]);
  const res = await metrics(a, admin.token);
  assert.equal(res.body.secondVisitRate, 0.5); // returns: a, e. Second visits: a.
});

test("comebackRate counts only comebacks old enough to judge, and deferrals only count active users", { skip }, async () => {
  const a = metricsApp();
  const u1 = await setup(a, { email: "c1@example.com", username: "cb_one" });
  const u2 = await setup(a, { email: "c2@example.com", username: "cb_two" });
  const admin = await makeAdmin(a);
  const day = (n: number) => addDays(localDate(NOW, TZ), -n);
  await db!.insert(comebacks).values([
    { userId: u1.id, startedOn: day(20), gapDays: 6, completedAt: NOW },
    { userId: u1.id, startedOn: day(10), gapDays: 6, completedAt: null },
    { userId: u1.id, startedOn: day(3), gapDays: 6, completedAt: null }, // too recent to judge
  ]);
  await db!.insert(logs).values({ userId: u1.id, clientId: "x1", domain: "MIND", logType: "journal", occurredAt: NOW, localDate: day(0) });
  const quest = (userId: string, title: string) => ({
    userId, type: "daily", title, description: "d", domain: "BODY", status: "refused", expiresAt: NOW, refusalReason: "why", resolvedLocalDate: day(1),
  });
  await db!.insert(quests).values([quest(u1.id, "q1"), quest(u2.id, "q2")]); // u2 never logged: not active
  const res = await metrics(a, admin.token);
  assert.equal(res.body.comebackRate, 0.5);
  assert.equal(res.body.deferralsPerActiveUser, 1); // 1 refusal by an active user / 1 active user
});
