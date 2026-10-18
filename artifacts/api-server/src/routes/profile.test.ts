import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { eq } from "drizzle-orm";
import { closeTestDb, resetDb } from "@workspace/db/testing";
import { profiles } from "@workspace/db";
import { GameStateSchema } from "@workspace/contracts";
import { app, assertContract, auth, db, setup, skip } from "./game-test-helpers";

after(async () => {
  await closeTestDb();
});
beforeEach(async () => {
  if (db) await resetDb(db);
});

const profileShape = GameStateSchema.shape.profile;

test("PATCH /profile updates times", { skip }, async () => {
  const a = app();
  const { token, id } = await setup(a);
  const res = await request(a)
    .patch("/api/profile")
    .set(auth(token))
    .send({ morningTime: "05:30", nightlyTime: "22:00" });
  assert.equal(res.status, 200);
  const profile = assertContract(profileShape, res.body);
  assert.equal(profile.morningTime, "05:30");
  assert.equal(profile.nightlyTime, "22:00");
  assert.equal(profile.primaryGoal, "Build a disciplined life");
  const [row] = await db!.select().from(profiles).where(eq(profiles.userId, id));
  assert.equal(row!.morningTime, "05:30");
  assert.equal(row!.nightlyTime, "22:00");
  const state = await request(a).get("/api/state").set(auth(token));
  assert.equal(state.body.profile.morningTime, "05:30");
});

test("PATCH /profile changes only the fields sent", { skip }, async () => {
  const a = app();
  const { token } = await setup(a);
  const res = await request(a)
    .patch("/api/profile")
    .set(auth(token))
    .send({ identitySetting: "public", primaryGoal: "  Run a marathon  " });
  assert.equal(res.status, 200);
  assert.equal(res.body.identitySetting, "public");
  assert.equal(res.body.primaryGoal, "Run a marathon");
  assert.equal(res.body.morningTime, "06:30");
  assert.equal(res.body.nightlyTime, "21:30");
});

test("PATCH /profile invalid time -> 400", { skip }, async () => {
  const a = app();
  const { token } = await setup(a);
  for (const bad of [{ morningTime: "25:00" }, { nightlyTime: "7:30" }, { morningTime: "06:60" }, { morningTime: 630 }]) {
    const res = await request(a).patch("/api/profile").set(auth(token)).send(bad);
    assert.equal(res.status, 400, JSON.stringify(bad));
  }
  const state = await request(a).get("/api/state").set(auth(token));
  assert.equal(state.body.profile.morningTime, "06:30");
});

test("PATCH /profile rejects an empty body, a short goal and unknown identity", { skip }, async () => {
  const a = app();
  const { token } = await setup(a);
  for (const bad of [{}, { primaryGoal: "abc" }, { primaryGoal: "x".repeat(201) }, { identitySetting: "nobody" }]) {
    const res = await request(a).patch("/api/profile").set(auth(token)).send(bad);
    assert.equal(res.status, 400, JSON.stringify(bad));
  }
});

test("PATCH /profile requires auth and onboarding", { skip }, async () => {
  const a = app();
  assert.equal((await request(a).patch("/api/profile").send({ morningTime: "06:00" })).status, 401);
  const reg = await request(a).post("/api/auth/register").send({
    email: "bob@example.com",
    password: "correct horse battery",
    username: "bob_1",
    birthYear: 1990,
    acceptTerms: true,
    timezone: "Asia/Kolkata",
  });
  const res = await request(a)
    .patch("/api/profile")
    .set(auth(reg.body.accessToken))
    .send({ morningTime: "06:00" });
  assert.equal(res.status, 409);
  assert.equal(res.body.code, "not_onboarded");
});

test("PATCH /profile replays an Idempotency-Key with the stored result", { skip }, async () => {
  const a = app();
  const { token } = await setup(a);
  const send = (body: object) =>
    request(a).patch("/api/profile").set(auth(token)).set("Idempotency-Key", "profile-1").send(body);
  const first = await send({ morningTime: "05:00" });
  assert.equal(first.status, 200);
  await request(a).patch("/api/profile").set(auth(token)).send({ morningTime: "08:00" });
  const replay = await send({ morningTime: "05:00" });
  assert.equal(replay.status, 200);
  assert.equal(replay.body.morningTime, "05:00");
  const state = await request(a).get("/api/state").set(auth(token));
  assert.equal(state.body.profile.morningTime, "08:00");
});
