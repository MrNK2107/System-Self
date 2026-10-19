import test, { after, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { closeTestDb, resetDb } from "@workspace/db/testing";
import { comebacks, notices, profiles, quests, scoreEvents, userDayState, workoutSessions } from "@workspace/db";
import { addDays, localDate } from "@workspace/engine";
import {
  ComebackResponseSchema,
  GameStateSchema,
  LogResponseSchema,
  NoticeListResponseSchema,
  OnboardingRequestSchema,
  SessionCompleteResponseSchema,
} from "@workspace/contracts";
import { createQuests } from "../services/quests";
import { buildQuestPrompt, buildUserContext } from "../services/ai-context";
import { insertNotice } from "../services/scoring";
import { TZ, app, assertContract, assertStoredNoticesMatchContract, auth, db, score, setup, skip } from "./game-test-helpers";

after(async () => {
  await closeTestDb();
});
afterEach(async () => {
  await assertStoredNoticesMatchContract();
});
beforeEach(async () => {
  if (db) await resetDb(db);
});

// A fixed Monday, 12:00 in Asia/Kolkata: no test here reads the real clock.
const NOW = new Date("2026-06-08T06:30:00Z");
const TODAY = localDate(NOW, TZ);
const clockApp = () => app({ now: () => NOW });

/** Pins the user's history relative to NOW: onboarded 30 days ago, last active `lastActivity`, everything before today rolled. */
async function seed(userId: string, lastActivity: string | null) {
  await db!.update(profiles).set({ onboardedAt: new Date(NOW.getTime() - 30 * 86_400_000) }).where(eq(profiles.userId, userId));
  await db!
    .update(userDayState)
    .set({ lastActivityDate: lastActivity, lastRolledDate: addDays(TODAY, -1), nextRolloverAt: new Date(NOW.getTime() + 86_400_000) })
    .where(eq(userDayState.userId, userId));
}

const postLog = (a: ReturnType<typeof app>, token: string, clientId: string, domain = "BODY", logType = "workout") =>
  request(a).post("/api/logs").set(auth(token)).send({ clientId, domain, logType, occurredAt: NOW.toISOString() });

/** Marks a quest completed today without scoring it (quest routes read the real clock, these tests pin NOW). */
async function resolveQuest(questId: string) {
  await db!.update(quests).set({ status: "complete", resolvedAt: NOW, resolvedLocalDate: TODAY }).where(eq(quests.id, questId));
}

const kindsOf = (body: { notices: { kind: string }[] }) => body.notices.map((n) => n.kind);

test("notices kinds filter: GET /notices?kinds and GET /state?noticeKinds return only those kinds", { skip }, async () => {
  const a = clockApp();
  const { token, id } = await setup(a);
  await insertNotice(db!, id, "achievement", { id: "x", title: "T", description: "D", icon: "zap" }, new Date(NOW.getTime() - 3000));
  await insertNotice(db!, id, "shadow_resolved", { codename: "C" }, new Date(NOW.getTime() - 2000));
  await insertNotice(db!, id, "milestone", { domain: "BODY", tier: 60, title: "M" }, new Date(NOW.getTime() - 1000));

  const all = await request(a).get("/api/notices").set(auth(token));
  assert.deepEqual(all.body.items.map((n: { kind: string }) => n.kind), ["achievement", "shadow_resolved", "milestone"]);

  const some = await request(a).get("/api/notices?kinds=milestone,achievement").set(auth(token));
  assert.equal(some.status, 200);
  assertContract(NoticeListResponseSchema, some.body);
  assert.deepEqual(some.body.items.map((n: { kind: string }) => n.kind), ["achievement", "milestone"]);

  // Unknown kinds in the list are ignored; a list with none known returns nothing.
  const unknown = await request(a).get("/api/notices?kinds=milestone,from_the_future").set(auth(token));
  assert.deepEqual(unknown.body.items.map((n: { kind: string }) => n.kind), ["milestone"]);
  const none = await request(a).get("/api/notices?kinds=from_the_future").set(auth(token));
  assert.deepEqual(none.body, { items: [], hasMore: false });

  const state = await request(a).get("/api/state?noticeKinds=shadow_resolved").set(auth(token));
  assert.equal(state.status, 200);
  assertContract(GameStateSchema, state.body);
  assert.deepEqual(state.body.unseenNotices.map((n: { kind: string }) => n.kind), ["shadow_resolved"]);
  const stateAll = await request(a).get("/api/state").set(auth(token));
  assert.equal(stateAll.body.unseenNotices.length, 3);
});

test("notices kinds filter pages only the requested kinds (hasMore ignores other kinds)", { skip }, async () => {
  const a = clockApp();
  const { token, id } = await setup(a);
  for (let i = 0; i < 51; i++) {
    await insertNotice(db!, id, "shadow_resolved", { codename: `C${i}` }, new Date(NOW.getTime() + i));
  }
  await insertNotice(db!, id, "milestone", { domain: "BODY", tier: 60, title: "M" }, new Date(NOW.getTime() + 100));
  const onlyMilestone = await request(a).get("/api/notices?kinds=milestone").set(auth(token));
  assert.equal(onlyMilestone.body.items.length, 1);
  assert.equal(onlyMilestone.body.hasMore, false);
  const shadows = await request(a).get("/api/notices?kinds=shadow_resolved").set(auth(token));
  assert.equal(shadows.body.items.length, 50);
  assert.equal(shadows.body.hasMore, true);
});

test("first log after onboarding is not a comeback", { skip }, async () => {
  const a = clockApp();
  const { token, id } = await setup(a);
  await seed(id, null);
  const res = await postLog(a, token, "first");
  assert.equal(res.status, 201);
  assertContract(LogResponseSchema, res.body);
  assert.ok(!kindsOf(res.body).includes("comeback"));
  assert.equal((await db!.select().from(comebacks)).length, 0);
  // Only 4 empty days: still not a return.
  await seed(id, addDays(TODAY, -5));
  const four = await postLog(a, token, "four");
  assert.ok(!kindsOf(four.body).includes("comeback"));
});

test("log after 5 empty days -> comeback notice, no extra score events", { skip }, async () => {
  const a = clockApp();
  const { token, id } = await setup(a);
  await seed(id, addDays(TODAY, -6));
  const bodyBefore = (await score(id, "BODY")).score;
  const res = await postLog(a, token, "back");
  assert.equal(res.status, 201);
  assertContract(LogResponseSchema, res.body);
  const n = res.body.notices.find((x: { kind: string }) => x.kind === "comeback");
  assert.ok(n, "comeback notice");
  assert.deepEqual(n.payload, { gapDays: 5, line: "You returned. Most don't.", offerHomePath: true }); // 0 gym sessions
  // Exactly the one ordinary log event; the BODY score moved by the normal log delta only.
  const events = (await db!.select().from(scoreEvents).where(eq(scoreEvents.userId, id))).filter((e) => e.reason !== "onboarding");
  assert.deepEqual(events.map((e) => e.reason), ["log"]);
  assert.equal((await score(id, "BODY")).score, bodyBefore + 2.5);
  const rows = await db!.select().from(comebacks).where(eq(comebacks.userId, id));
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.startedOn, TODAY);
  assert.equal(rows[0]!.gapDays, 5);
  assert.equal(rows[0]!.completedAt, null);
  // A second log the same day is not another comeback.
  const again = await postLog(a, token, "back-2", "MIND", "read");
  assert.ok(!kindsOf(again.body).includes("comeback"));
  assert.equal((await db!.select().from(comebacks)).length, 1);
  // A replay returns the stored response without a second row.
  const replay = await postLog(a, token, "back");
  assert.equal(replay.status, 200);
  assert.equal((await db!.select().from(comebacks)).length, 1);
});

test("comeback after a 14+ day gap offers the home path", { skip }, async () => {
  const a = clockApp();
  const { token, id } = await setup(a);
  await seed(id, addDays(TODAY, -15));
  const long = await postLog(a, token, "long");
  const n = long.body.notices.find((x: { kind: string }) => x.kind === "comeback");
  assert.equal(n.payload.gapDays, 14);
  assert.equal(n.payload.offerHomePath, true);
});

test("comeback after a short gap does not offer the home path to someone with a completed gym session", { skip }, async () => {
  const a = clockApp();
  const { token, id } = await setup(a);
  await db!.insert(workoutSessions).values({ userId: id, startedAt: NOW, completedAt: NOW, localDate: addDays(TODAY, -20), clientId: "old-gym" });
  await seed(id, addDays(TODAY, -6));
  const res = await postLog(a, token, "short");
  const n = res.body.notices.find((x: { kind: string }) => x.kind === "comeback");
  assert.deepEqual(n.payload, { gapDays: 5, line: "You returned. Most don't.", offerHomePath: false });
});

test("GET /comeback: nothing active, then the checklist completes into a returner mark (count 1, no score change)", { skip }, async () => {
  const a = clockApp();
  const { token, id } = await setup(a);
  await seed(id, addDays(TODAY, -7));
  const idle = await request(a).get("/api/comeback").set(auth(token));
  assert.equal(idle.status, 200);
  assertContract(ComebackResponseSchema, idle.body);
  assert.deepEqual(idle.body, { active: null, returnerCount: 0 });

  await postLog(a, token, "c-body"); // BODY log: comeback starts, body_session done
  const q = (
    await createQuests(db!, id, [
      { type: "daily", title: "Walk", description: "d", domain: "BODY", expiresAt: new Date(NOW.getTime() + 3600_000) },
    ])
  )[0]!;
  const mid = await request(a).get("/api/comeback").set(auth(token));
  assertContract(ComebackResponseSchema, mid.body);
  assert.equal(mid.body.active.gapDays, 6);
  assert.deepEqual(mid.body.active.checklist, [
    { key: "body_session", label: "Log one BODY session", done: true },
    { key: "quests_today", label: "Complete today's quests", done: false },
    { key: "two_domains", label: "Log two different domains today", done: false },
  ]);
  assert.equal((await db!.select().from(notices).where(eq(notices.kind, "returner_mark"))).length, 0);

  await postLog(a, token, "c-mind", "MIND", "read");
  await resolveQuest(q.id);
  const eventsBefore = (await db!.select().from(scoreEvents).where(eq(scoreEvents.userId, id))).length;

  const fin = await request(a).get("/api/comeback").set(auth(token));
  assertContract(ComebackResponseSchema, fin.body);
  assert.deepEqual(fin.body, { active: null, returnerCount: 1 });
  const marks = await db!.select().from(notices).where(and(eq(notices.userId, id), eq(notices.kind, "returner_mark")));
  assert.equal(marks.length, 1);
  assert.deepEqual(marks[0]!.payload, { count: 1, line: "Returned ×1." });
  const [row] = await db!.select().from(comebacks).where(eq(comebacks.userId, id));
  assert.ok(row!.completedAt);
  // The mark pays nothing, and asking again does not count twice.
  assert.equal((await db!.select().from(scoreEvents).where(eq(scoreEvents.userId, id))).length, eventsBefore);
  const again = await request(a).get("/api/comeback").set(auth(token));
  assert.deepEqual(again.body, { active: null, returnerCount: 1 });
  assert.equal((await db!.select().from(notices).where(eq(notices.kind, "returner_mark"))).length, 1);
});

test("a second return stacks the returner count", { skip }, async () => {
  const a = clockApp();
  const { token, id } = await setup(a);
  await db!.update(profiles).set({ returnerCount: 2 }).where(eq(profiles.userId, id));
  await seed(id, addDays(TODAY, -8));
  await postLog(a, token, "r-body");
  await postLog(a, token, "r-mind", "MIND", "read");
  const q = (
    await createQuests(db!, id, [
      { type: "daily", title: "Walk", description: "d", domain: "BODY", expiresAt: new Date(NOW.getTime() + 3600_000) },
    ])
  )[0]!;
  await resolveQuest(q.id);
  const fin = await request(a).get("/api/comeback").set(auth(token));
  assert.deepEqual(fin.body, { active: null, returnerCount: 3 });
  const [mark] = await db!.select().from(notices).where(eq(notices.kind, "returner_mark"));
  assert.deepEqual(mark!.payload, { count: 3, line: "Returned ×3." });
});

test("home path: toggle via POST /profile/home-path, state exposes it, quest prompt names it", { skip }, async () => {
  const a = clockApp();
  const { token, id } = await setup(a);
  assert.equal((await request(a).get("/api/state").set(auth(token))).body.profile.homePathActive, false);
  const bad = await request(a).post("/api/profile/home-path").set(auth(token)).send({ active: "yes" });
  assert.equal(bad.status, 400);
  const on = await request(a).post("/api/profile/home-path").set(auth(token)).send({ active: true });
  assert.equal(on.status, 200);
  assert.equal(on.body.homePathActive, true);
  const state = assertContract(GameStateSchema, (await request(a).get("/api/state").set(auth(token))).body);
  assert.equal(state.profile.homePathActive, true);
  const line =
    'The user is on the home path. BODY quests must be bodyweight sessions doable at home in under 25 minutes. Use the words "home session".';
  const ctx = (await buildUserContext(db!, id, NOW))!;
  assert.ok(buildQuestPrompt(ctx, { daily: 3, weekly: 1, arc: 1 }).includes(line));
  await request(a).post("/api/profile/home-path").set(auth(token)).send({ active: false });
  const off = (await buildUserContext(db!, id, NOW))!;
  assert.ok(!buildQuestPrompt(off, { daily: 3, weekly: 1, arc: 1 }).includes("home path"));
});

test("onboarding can start on the home path", { skip }, async () => {
  assert.equal(OnboardingRequestSchema.shape.homePathActive.safeParse(true).success, true);
  const a = clockApp();
  const res = await request(a).post("/api/auth/register").send({
    email: "bob@example.com",
    password: "correct horse battery",
    username: "bob_1",
    birthYear: 1990,
    acceptTerms: true,
    timezone: TZ,
  });
  const token = res.body.accessToken as string;
  const ob = await request(a)
    .post("/api/onboarding")
    .set(auth(token))
    .send({
      ratings: { BODY: 5, MIND: 6, WEALTH: 4, SOCIAL: 7, DISCIPLINE: 3 },
      primaryGoal: "Build a disciplined life",
      biggestWeakness: "BODY",
      identitySetting: "anonymous",
      morningTime: "06:30",
      nightlyTime: "21:30",
      timezone: TZ,
      homePathActive: true,
    });
  assert.equal(ob.status, 201);
  assert.equal(ob.body.profile.homePathActive, true);
});

test("6 home sessions unlock the gym", { skip }, async () => {
  const a = clockApp();
  const { token, id } = await setup(a);
  await seed(id, null);
  // Not on the home path: home sessions do not count.
  await postLog(a, token, "pre", "BODY", "home_session");
  assert.equal((await db!.select().from(profiles).where(eq(profiles.userId, id)))[0]!.homeSessions, 0);
  await request(a).post("/api/profile/home-path").set(auth(token)).send({ active: true });
  const types = ["home_session", "floor_session", "home_session", "home_session", "floor_session"];
  for (const [i, t] of types.entries()) {
    const r = await postLog(a, token, `h${i}`, "BODY", t);
    assert.equal(r.status, 201);
    assert.ok(!kindsOf(r.body).includes("gym_unlocked"));
  }
  let [p] = await db!.select().from(profiles).where(eq(profiles.userId, id));
  assert.equal(p!.homeSessions, 5);
  assert.equal(p!.homePathActive, true);
  // A non-home log does not count.
  await postLog(a, token, "other", "BODY", "workout");
  [p] = await db!.select().from(profiles).where(eq(profiles.userId, id));
  assert.equal(p!.homeSessions, 5);
  const sixth = await postLog(a, token, "h5", "BODY", "home_session");
  assertContract(LogResponseSchema, sixth.body);
  const unlock = sixth.body.notices.find((x: { kind: string }) => x.kind === "gym_unlocked");
  assert.deepEqual(unlock.payload, { line: "Tier I cleared. The gym is open to you now." });
  [p] = await db!.select().from(profiles).where(eq(profiles.userId, id));
  assert.equal(p!.homePathActive, false);
  assert.equal(p!.homeSessions, 6);
  assert.equal((await request(a).get("/api/state").set(auth(token))).body.profile.homePathActive, false);
  // Past the unlock the counter stops, and re-opting in starts a fresh count.
  const seventh = await postLog(a, token, "h6", "BODY", "home_session");
  assert.ok(!kindsOf(seventh.body).includes("gym_unlocked"));
  await request(a).post("/api/profile/home-path").set(auth(token)).send({ active: true });
  [p] = await db!.select().from(profiles).where(eq(profiles.userId, id));
  assert.equal(p!.homeSessions, 0);
});

test("gym session while home path active still scores (and a gym return after a gap is a comeback)", { skip }, async () => {
  const a = clockApp(); // NOW is a Monday: the starter plan has a MON block
  const { token, id } = await setup(a);
  await seed(id, addDays(TODAY, -9));
  await request(a).post("/api/profile/home-path").set(auth(token)).send({ active: true });
  await request(a).get("/api/gym").set(auth(token)); // creates the starter plan
  const s = await request(a).post("/api/gym/sessions").set(auth(token)).send({ clientId: "gs-1" });
  assert.equal(s.status, 201);
  await request(a)
    .post(`/api/gym/sessions/${s.body.id}/sets`)
    .set(auth(token))
    .send({ exerciseId: "ex_squat", reps: 5, weight: 100, completed: true });
  const before = (await score(id, "BODY")).score;
  const done = await request(a).post(`/api/gym/sessions/${s.body.id}/complete`).set(auth(token)).send({});
  assert.equal(done.status, 200);
  assertContract(SessionCompleteResponseSchema, done.body);
  assert.ok(done.body.points > 0);
  assert.ok((await score(id, "BODY")).score > before);
  assert.ok(kindsOf(done.body).includes("comeback"));
  const [p] = await db!.select().from(profiles).where(eq(profiles.userId, id));
  assert.equal(p!.homePathActive, true); // gym logging neither blocks nor counts as a home session
  assert.equal(p!.homeSessions, 0);
});
