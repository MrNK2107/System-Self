import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { eq } from "drizzle-orm";
import { closeTestDb, getTestDb, resetDb } from "@workspace/db/testing";
import { dailySnapshots, profiles, scoreEvents, shadowSelves, userDayState, users } from "@workspace/db";
import { GameStateSchema } from "@workspace/contracts";
import { createApp } from "../app-factory";
import type { Mailer } from "../lib/mailer";
import { assertContract } from "./game-test-helpers";

const db = getTestDb();
const skip = db ? false : "TEST_DATABASE_URL not set";
const mailer: Mailer = { async send() {} };

after(async () => {
  await closeTestDb();
});
beforeEach(async () => {
  if (db) await resetDb(db);
});

const app = () => createApp({ db, mailer });

async function register(a: ReturnType<typeof app>) {
  const res = await request(a).post("/api/auth/register").send({
    email: "alice@example.com",
    password: "correct horse battery",
    username: "alice_1",
    birthYear: 1990,
    acceptTerms: true,
    timezone: "Asia/Kolkata",
  });
  assert.equal(res.status, 201);
  return { token: res.body.accessToken as string, id: res.body.user.id as string };
}

const body = (over: Record<string, unknown> = {}) => ({
  ratings: { BODY: 5, MIND: 6, WEALTH: 4, SOCIAL: 7, DISCIPLINE: 3 },
  primaryGoal: "Build a disciplined life",
  biggestWeakness: "DISCIPLINE",
  identitySetting: "anonymous",
  morningTime: "06:30",
  nightlyTime: "21:30",
  timezone: "Asia/Kolkata",
  ...over,
});

function findKey(v: unknown, key: string): boolean {
  if (Array.isArray(v)) return v.some((x) => findKey(x, key));
  if (v && typeof v === "object") {
    return Object.entries(v).some(([k, x]) => k.toLowerCase().includes(key) || findKey(x, key));
  }
  return false;
}

test("onboarding sets scores rating*4, rank E, no shadow, returns GameState", { skip }, async () => {
  const a = app();
  const { token, id } = await register(a);
  const res = await request(a).post("/api/onboarding").set("Authorization", `Bearer ${token}`).send(body());
  assert.equal(res.status, 201);
  const state = assertContract(GameStateSchema, res.body);
  assert.equal(state.profile.rank, "E");
  assert.equal(state.profile.onboarded, true);
  assert.equal(state.profile.dayNumber, 1);
  assert.match(state.profile.codename, /^GHOST \/\/ [A-Z0-9]{3}-[1-9]$/);
  assert.equal(state.shadow, null);
  const byDomain = Object.fromEntries(state.scores.map((s) => [s.domain, s.score]));
  assert.deepEqual(byDomain, { BODY: 20, MIND: 24, WEALTH: 16, SOCIAL: 28, DISCIPLINE: 12 });
  assert.deepEqual(
    state.scores.map((s) => s.domain),
    ["BODY", "MIND", "WEALTH", "SOCIAL", "DISCIPLINE"],
  );
  const events = await db!.select().from(scoreEvents).where(eq(scoreEvents.userId, id));
  assert.equal(events.length, 5);
  assert.ok(events.every((e) => e.reason === "onboarding"));
  assert.equal((await db!.select().from(dailySnapshots).where(eq(dailySnapshots.userId, id))).length, 1);
  assert.equal((await db!.select().from(shadowSelves).where(eq(shadowSelves.userId, id))).length, 0);
  const [dayState] = await db!.select().from(userDayState).where(eq(userDayState.userId, id));
  assert.ok(dayState!.nextRolloverAt.getTime() > Date.now());
  const [u] = await db!.select().from(users).where(eq(users.id, id));
  assert.equal(u!.timezone, "Asia/Kolkata");
});

test("second onboarding -> 409 already_onboarded", { skip }, async () => {
  const a = app();
  const { token } = await register(a);
  await request(a).post("/api/onboarding").set("Authorization", `Bearer ${token}`).send(body());
  const res = await request(a).post("/api/onboarding").set("Authorization", `Bearer ${token}`).send(body());
  assert.equal(res.status, 409);
  assert.equal(res.body.code, "already_onboarded");
});

test("onboarding with the same Idempotency-Key replays with 200", { skip }, async () => {
  const a = app();
  const { token } = await register(a);
  const first = await request(a)
    .post("/api/onboarding")
    .set("Authorization", `Bearer ${token}`)
    .set("Idempotency-Key", "k1")
    .send(body());
  assert.equal(first.status, 201);
  const again = await request(a)
    .post("/api/onboarding")
    .set("Authorization", `Bearer ${token}`)
    .set("Idempotency-Key", "k1")
    .send(body());
  assert.equal(again.status, 200);
  assert.equal(again.body.profile.codename, first.body.profile.codename);
});

test("onboarding validation -> 400, unauthenticated -> 401", { skip }, async () => {
  const a = app();
  const { token } = await register(a);
  const bad = await request(a)
    .post("/api/onboarding")
    .set("Authorization", `Bearer ${token}`)
    .send(body({ ratings: { BODY: 11, MIND: 6, WEALTH: 4, SOCIAL: 7, DISCIPLINE: 3 } }));
  assert.equal(bad.status, 400);
  assert.equal((await request(a).post("/api/onboarding").send(body())).status, 401);
});

test("GET /state before onboarding -> 404 not_onboarded", { skip }, async () => {
  const a = app();
  const { token } = await register(a);
  const res = await request(a).get("/api/state").set("Authorization", `Bearer ${token}`);
  assert.equal(res.status, 404);
  assert.equal(res.body.code, "not_onboarded");
});

test("GET /state after onboarding returns GameState and never a hidden key (deep scan)", { skip }, async () => {
  const a = app();
  const { token } = await register(a);
  const created = await request(a).post("/api/onboarding").set("Authorization", `Bearer ${token}`).send(body());
  const res = await request(a).get("/api/state").set("Authorization", `Bearer ${token}`);
  assert.equal(res.status, 200);
  assertContract(GameStateSchema, res.body);
  assert.equal(findKey(res.body, "hidden"), false);
  assert.equal(findKey(created.body, "hidden"), false);
  assert.ok(["up", "stable", "down"].includes(res.body.trajectory));
  assert.equal(typeof res.body.tierProgress, "number");
});

test("concurrent same-key onboarding -> {201, 200}, identical bodies, one profile and one score set", { skip }, async () => {
  const a = app();
  const { token, id } = await register(a);
  const send = () =>
    request(a)
      .post("/api/onboarding")
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", "same")
      .send(body());
  const [r1, r2] = await Promise.all([send(), send()]);
  assert.deepEqual([r1.status, r2.status].sort(), [200, 201]);
  assert.deepEqual(r1.body, r2.body);
  assert.equal((await db!.select().from(profiles).where(eq(profiles.userId, id))).length, 1);
  assert.equal((await db!.select().from(scoreEvents).where(eq(scoreEvents.userId, id))).length, 5);
});
