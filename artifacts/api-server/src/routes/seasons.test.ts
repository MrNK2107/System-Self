import test, { after, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { eq } from "drizzle-orm";
import { closeTestDb, resetDb } from "@workspace/db/testing";
import { profiles, seasons } from "@workspace/db";
import { SEASON_PROMPT_LINE, addDays, localDate } from "@workspace/engine";
import { GameStateSchema, QuestGenerateResponseSchema, SeasonSchema, SeasonsResponseSchema } from "@workspace/contracts";
import { buildQuestPrompt, buildUserContext } from "../services/ai-context";
import { TZ, app, assertContract, assertStoredNoticesMatchContract, auth, db, setup, skip } from "./game-test-helpers";

after(async () => {
  await closeTestDb();
});
afterEach(async () => {
  await assertStoredNoticesMatchContract();
});

// A fixed Monday, 12:00 in Asia/Kolkata: the season routes read the injected clock only.
const START = new Date("2026-06-08T06:30:00Z");
let now = START;
beforeEach(async () => {
  now = START;
  if (db) await resetDb(db);
});
const clockApp = () => app({ now: () => now });
const TODAY = () => localDate(now, TZ);
const TOMORROW = () => addDays(TODAY(), 1);

const post = (a: ReturnType<typeof app>, token: string, body: object) => request(a).post("/api/seasons").set(auth(token)).send(body);

test("POST season then GET shows scheduled; after startsOn it is active", { skip }, async () => {
  const a = clockApp();
  const { token } = await setup(a);
  const empty = await request(a).get("/api/seasons").set(auth(token));
  assertContract(SeasonsResponseSchema, empty.body);
  assert.deepEqual(empty.body, { active: null, scheduled: null, availableKinds: ["exam", "away"] });

  const created = await post(a, token, { kind: "exam", startsOn: TOMORROW(), lengthDays: 5 });
  assert.equal(created.status, 201);
  assertContract(SeasonSchema, created.body);
  assert.equal(created.body.endsOn, addDays(TOMORROW(), 4));
  assert.equal(created.body.line, "Exam Season. The volume drops. The standard does not.");

  const scheduled = await request(a).get("/api/seasons").set(auth(token));
  assert.equal(scheduled.body.active, null);
  assert.equal(scheduled.body.scheduled.id, created.body.id);

  now = new Date(now.getTime() + 86_400_000);
  const active = await request(a).get("/api/seasons").set(auth(token));
  assert.equal(active.body.scheduled, null);
  assert.equal(active.body.active.id, created.body.id);

  // After the end it is neither active nor scheduled.
  now = new Date(now.getTime() + 6 * 86_400_000);
  const over = await request(a).get("/api/seasons").set(auth(token));
  assert.equal(over.body.active, null);
});

test("GameState.profile carries lifeContext and the running season (null otherwise)", { skip }, async () => {
  const a = app(); // /api/state reads the real clock: use a wide window around the real date
  const { token, id } = await setup(a);
  let state = await request(a).get("/api/state").set(auth(token));
  assertContract(GameStateSchema, state.body);
  assert.equal(state.body.profile.season, null);
  assert.equal(state.body.profile.lifeContext, "student");
  const t = localDate(new Date(), TZ);
  await db!.insert(seasons).values({ userId: id, kind: "exam", startsOn: addDays(t, -3), endsOn: addDays(t, 10) });
  await db!.insert(seasons).values({ userId: id, kind: "away", startsOn: addDays(t, 40), endsOn: addDays(t, 41) });
  state = await request(a).get("/api/state").set(auth(token));
  assertContract(GameStateSchema, state.body);
  assert.deepEqual(state.body.profile.season, {
    kind: "exam",
    endsOn: addDays(t, 10),
    line: "Exam Season. The volume drops. The standard does not.",
  });
});

test("season validation: conflict 409, invalid kind and dates 400, with the code in the body", { skip }, async () => {
  const a = clockApp();
  const { token } = await setup(a);
  const bad = async (body: object, status: number, code: string) => {
    const r = await post(a, token, body);
    assert.equal(r.status, status, JSON.stringify(r.body));
    assert.equal(r.body.code, code);
  };
  await bad({ kind: "crunch", startsOn: TOMORROW(), lengthDays: 3 }, 400, "invalid_kind"); // student has no crunch
  await bad({ kind: "exam", startsOn: TODAY(), lengthDays: 3 }, 400, "invalid_dates");
  await bad({ kind: "exam", startsOn: TOMORROW(), lengthDays: 15 }, 400, "invalid_dates");
  assert.equal((await post(a, token, { kind: "exam", startsOn: TOMORROW(), lengthDays: 7 })).status, 201);
  await bad({ kind: "away", startsOn: addDays(TOMORROW(), 3), lengthDays: 2 }, 409, "season_conflict"); // overlap
  await bad({ kind: "away", startsOn: addDays(TOMORROW(), 20), lengthDays: 2 }, 409, "season_conflict"); // one at a time
  assert.equal((await post(a, token, { kind: "exam" })).status, 400); // malformed body
});

test("cooldown: a season may start 8 days after the previous one ends, not sooner", { skip }, async () => {
  const a = clockApp();
  const { token, id } = await setup(a);
  await db!.insert(seasons).values({ userId: id, kind: "exam", startsOn: addDays(TODAY(), -6), endsOn: addDays(TODAY(), -1) });
  const tooSoon = await post(a, token, { kind: "exam", startsOn: addDays(TODAY(), 6), lengthDays: 2 });
  assert.equal(tooSoon.status, 409);
  assert.equal(tooSoon.body.code, "season_conflict");
  assert.equal((await post(a, token, { kind: "exam", startsOn: addDays(TODAY(), 7), lengthDays: 2 })).status, 201);
});

test("delete a scheduled season -> 204; a started season -> 409 season_started", { skip }, async () => {
  const a = clockApp();
  const { token } = await setup(a);
  const created = await post(a, token, { kind: "away", startsOn: TOMORROW(), lengthDays: 3 });
  assert.equal(created.status, 201);
  const del = await request(a).delete(`/api/seasons/${created.body.id}`).set(auth(token));
  assert.equal(del.status, 204);
  assert.equal((await request(a).get("/api/seasons").set(auth(token))).body.scheduled, null);
  assert.equal((await request(a).delete(`/api/seasons/${created.body.id}`).set(auth(token))).status, 404);
  assert.equal((await request(a).delete("/api/seasons/not-a-uuid").set(auth(token))).status, 404);

  const again = await post(a, token, { kind: "away", startsOn: TOMORROW(), lengthDays: 3 });
  now = new Date(now.getTime() + 86_400_000); // it has started
  const started = await request(a).delete(`/api/seasons/${again.body.id}`).set(auth(token));
  assert.equal(started.status, 409);
  assert.equal(started.body.code, "season_started");
  assert.equal((await db!.select().from(seasons)).length, 1);
});

test("seasons are per user: another user cannot read or delete a season", { skip }, async () => {
  const a = clockApp();
  const alice = await setup(a);
  const bob = await setup(a, { email: "bob@example.com", username: "bob_1" });
  const created = await post(a, alice.token, { kind: "away", startsOn: TOMORROW(), lengthDays: 3 });
  assert.equal((await request(a).get("/api/seasons").set(auth(bob.token))).body.scheduled, null);
  assert.equal((await request(a).delete(`/api/seasons/${created.body.id}`).set(auth(bob.token))).status, 404);
});

test("life context: onboarding default, PATCH /profile changes it and the available kinds follow", { skip }, async () => {
  const a = clockApp();
  const { token, id } = await setup(a);
  const [p] = await db!.select().from(profiles).where(eq(profiles.userId, id));
  assert.equal(p!.lifeContext, "student");
  const patched = await request(a).patch("/api/profile").set(auth(token)).send({ lifeContext: "athlete" });
  assert.equal(patched.status, 200);
  assert.equal(patched.body.lifeContext, "athlete");
  assert.deepEqual((await request(a).get("/api/seasons").set(auth(token))).body.availableKinds, ["competition", "away"]);
  assert.equal((await request(a).patch("/api/profile").set(auth(token)).send({ lifeContext: "pirate" })).status, 400);

  const b = await request(a)
    .post("/api/auth/register")
    .send({ email: "pat@example.com", password: "correct horse battery", username: "pat_1", birthYear: 1990, acceptTerms: true, timezone: TZ });
  const ob = await request(a)
    .post("/api/onboarding")
    .set(auth(b.body.accessToken))
    .send({
      ratings: { BODY: 5, MIND: 6, WEALTH: 4, SOCIAL: 7, DISCIPLINE: 3 },
      primaryGoal: "Build a disciplined life",
      biggestWeakness: "DISCIPLINE",
      identitySetting: "anonymous",
      morningTime: "06:30",
      nightlyTime: "21:30",
      timezone: TZ,
      lifeContext: "founder",
    });
  assert.equal(ob.status, 201);
  const [pf] = await db!.select().from(profiles).where(eq(profiles.userId, b.body.user.id));
  assert.equal(pf!.lifeContext, "founder");
});

test("the quest prompt carries the context line, and the season line only while a season is active", { skip }, async () => {
  const a = clockApp();
  const { token, id } = await setup(a);
  await request(a).patch("/api/profile").set(auth(token)).send({ lifeContext: "parent" });
  const need = { daily: 3, weekly: 1, arc: 1 };
  const plain = buildQuestPrompt((await buildUserContext(db!, id, now))!, need);
  assert.ok(plain.includes("Windows are short. BODY quests must be doable at home in under 20 minutes."));
  assert.ok(!plain.includes(SEASON_PROMPT_LINE));
  await db!.insert(seasons).values({ userId: id, kind: "away", startsOn: TODAY(), endsOn: addDays(TODAY(), 2) });
  const seasonal = buildQuestPrompt((await buildUserContext(db!, id, now))!, need);
  assert.ok(seasonal.includes(SEASON_PROMPT_LINE));
  assert.ok(seasonal.includes("exactly 3 daily quests"));
});

test("generation with an active season still tops up to 3 dailies, 1 weekly, 1 arc", { skip }, async () => {
  const a = app();
  const { token, id } = await setup(a);
  const t = localDate(new Date(), TZ); // a wide window so the real date cannot fall outside it
  await db!.insert(seasons).values({ userId: id, kind: "away", startsOn: addDays(t, -3), endsOn: addDays(t, 10) });
  const res = await request(a).post("/api/quests/generate").set(auth(token)).send({});
  assert.equal(res.status, 200);
  assertContract(QuestGenerateResponseSchema, res.body);
  assert.deepEqual(res.body.active.map((q: { type: string }) => q.type).sort(), ["arc", "daily", "daily", "daily", "weekly"]);
  for (const q of res.body.active.filter((q: { domain: string }) => q.domain === "BODY")) {
    assert.match(q.title + q.description, /home|bodyweight/i);
  }
});
