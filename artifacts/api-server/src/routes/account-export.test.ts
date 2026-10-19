import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { eq, sql } from "drizzle-orm";
import { closeTestDb, resetDb } from "@workspace/db/testing";
import * as s from "@workspace/db/schema";
import { app, auth, db, setup, skip } from "./game-test-helpers";
import { EXPORT_TABLES } from "../services/export";
import { EXPORT_RATE_LIMIT_MAX } from "./account";
import { createApp } from "../app-factory";

after(async () => {
  await closeTestDb();
});
beforeEach(async () => {
  if (db) await resetDb(db);
});

const NOW = new Date("2026-03-04T10:00:00Z");
const DAY = "2026-03-04";
const WEEK = "2026-W10";

/** Gives `me` a row in every exported table, with other players (B: clanmate/duo/rival/opponent, C: stranger) all around. */
async function seedEverything(me: string, b: string, c: string) {
  const d = db!;
  const [quest] = await d.insert(s.quests).values({ userId: me, type: "daily", title: "Run 5k", description: "Go", domain: "BODY", expiresAt: NOW }).returning();
  await d.insert(s.logs).values({ userId: me, clientId: "log-1", domain: "BODY", logType: "workout", occurredAt: NOW, localDate: DAY, freeText: "ran 5k" });
  await d.insert(s.scoreEvents).values({ userId: me, domain: "BODY", delta: 1, actualDelta: 1, reason: "log", localDate: DAY });
  await d.insert(s.dailySnapshots).values({ userId: me, localDate: DAY, scores: { BODY: 50 }, hidden: 31.337, rank: "E" });
  await d.insert(s.questChains).values({ userId: me, templateKey: "t", name: "Chain", domain: "BODY", totalSteps: 3 });
  await d.insert(s.shadowSelves).values({ userId: me, codename: "SHADOW // X" });
  await d.insert(s.achievements).values({ userId: me, achievementId: "first", unlockedAt: NOW });
  await d.insert(s.milestones).values({ userId: me, domain: "BODY", tier: 1, unlockedAt: NOW });
  const [notice] = await d.insert(s.notices).values({ userId: me, kind: "shame", payload: { handle: "bob_1", leakedId: b } }).returning();
  await d.insert(s.rankFreezes).values({ userId: me, startedOn: DAY, untilOn: "2026-03-10", month: "2026-03", reason: "rest" });
  await d.insert(s.debriefs).values({ userId: me, localDate: DAY, text: "debrief" });
  await d.insert(s.shadowTakeovers).values({ userId: me, questId: quest!.id, questTitle: "Run 5k", localDate: DAY });
  await d.insert(s.comebacks).values({ userId: me, startedOn: DAY, gapDays: 4 });
  await d.insert(s.seasons).values({ userId: me, kind: "quarter", startsOn: DAY, endsOn: "2026-06-04" });
  await d.insert(s.analyticsEvents).values({ userId: me, name: "app_open", props: {} });
  await d.insert(s.systemMessages).values({
    userId: me,
    messageType: "morning",
    rank: "E",
    trajectory: "up",
    shadowActive: false,
    shadowGap: 0,
    dayNumber: 1,
    message: "Begin.",
    model: "m",
    promptVersion: "v1",
    attempts: 1,
    context: { note: `rival ${c}` },
  });
  const [batch] = await d
    .insert(s.generatedQuestBatches)
    .values({ userId: me, rank: "E", weakestDomain: "BODY", primaryGoal: "g", dayNumber: 1, shadowGap: 0, model: "m", promptVersion: "v1", attempts: 1 })
    .returning();
  await d.insert(s.generatedQuests).values({ batchId: batch!.id, userId: me, title: "t", description: "d", domain: "BODY", type: "daily" });
  await d.insert(s.questCompletionEvents).values({ userId: me, questId: quest!.id, status: "completed", domain: "BODY", questType: "daily" });
  await d.insert(s.aiUsageDaily).values({ userId: me, localDate: DAY, name: "messages", count: 2 });
  await d.insert(s.notificationPrefs).values({ userId: me });
  await d.insert(s.notificationLog).values({ userId: me, localDate: DAY, kind: "morning" });
  await d.insert(s.noticePushes).values({ noticeId: notice!.id, userId: me, decision: "sent" });
  await d.insert(s.entitlements).values({ userId: me, tier: "pro", source: "revenuecat", productId: "pro_monthly" });
  await d.insert(s.billingEvents).values({ id: "evt_1", userId: me, type: "INITIAL_PURCHASE", payload: { app_user_id: me, other: c } });
  const ex = "bench";
  await d.insert(s.exercises).values({ id: "mine-1", userId: me, name: "Custom curl", primaryBodyPart: "arms" });
  const [plan] = await d.insert(s.workoutPlans).values({ userId: me, name: "Plan", goal: "strength", days: [] }).returning();
  const [session] = await d.insert(s.workoutSessions).values({ userId: me, planId: plan!.id, startedAt: NOW, localDate: DAY, clientId: "ws-1" }).returning();
  await d.insert(s.performedSets).values({ sessionId: session!.id, exerciseId: ex, setIndex: 0, reps: 5 });
  await d.insert(s.personalRecords).values({ userId: me, exerciseId: ex, value: 100, reps: 5, weight: 100, achievedAt: NOW });
  await d.insert(s.bodyPartScores).values({ userId: me, bodyPart: "chest" });
  await d.insert(s.gymCrowdReports).values({ userId: me, sessionId: session!.id, level: "quiet", weekday: 2, hour: 7 });
  const [dom] = await d.insert(s.customDomains).values({ userId: me, name: "Reading", baseline: 0, target: 10 }).returning();
  await d.insert(s.customLogs).values({ userId: me, customDomainId: dom!.id, clientId: "cl-1", value: 3, occurredAt: NOW, localDate: DAY });
  await d.insert(s.budgets).values({ userId: me, category: "food", monthlyLimit: 100 });
  await d.insert(s.recurringIncome).values({ userId: me, label: "Salary", amount: 1000, dayOfMonth: 1 });
  await d.insert(s.financialGoals).values({ userId: me, title: "Laptop", targetAmount: 500 });
  await d.insert(s.netWorthSnapshots).values({ userId: me, month: "2026-03", amount: 1234 });
  await d.insert(s.financeWeeks).values({ userId: me, weekKey: WEEK, evaluatedOn: DAY });
  // Peer ratings: I rated B; B and C rated me (never exported by rater); my weekly aggregate is.
  await d.insert(s.peerRatings).values([
    { raterId: me, rateeId: b, weekKey: WEEK, rating: 4 },
    { raterId: b, rateeId: me, weekKey: WEEK, rating: 2 },
    { raterId: c, rateeId: me, weekKey: WEEK, rating: 3 },
  ]);
  await d.insert(s.peerRatingWeeks).values({ userId: me, weekKey: WEEK, evaluatedOn: DAY, ratingCount: 2, average: 2.5 });
  await d.insert(s.follows).values([
    { followerId: me, followeeId: c },
    { followerId: c, followeeId: me },
  ]);
  await d.insert(s.blocks).values([
    { blockerId: me, blockedId: c },
    { blockerId: c, blockedId: me },
  ]);
  await d.insert(s.userReports).values([
    { reporterId: me, subjectId: c, subjectHandle: "carol_1", reason: "spam" },
    { reporterId: c, subjectId: me, reason: "reporter-secret" },
  ]);
  const [ghost] = await d.insert(s.ghostRivals).values({ ownerId: me, codename: "GHOST-1", rank: "E", scores: {}, trajectory: "stable" }).returning();
  const [asg] = await d
    .insert(s.rivalAssignments)
    .values([
      { userId: me, slot: 1, rivalUserId: b, codename: "RIVAL // ALPHA-1", expiresAt: NOW },
      { userId: me, slot: 2, ghostId: ghost!.id, codename: "RIVAL // GHOST-2", expiresAt: NOW },
      { userId: c, slot: 1, rivalUserId: me, codename: "RIVAL // THEIRS-9", expiresAt: NOW },
    ])
    .returning();
  await d.insert(s.rivalPressure).values({ userId: me, assignmentId: asg!.id, domain: "BODY", ahead: true });
  await d.insert(s.rivalChallenges).values({ userId: me, assignmentId: asg!.id, codename: "RIVAL // ALPHA-1", domain: "BODY", startDate: DAY, endDate: "2026-03-10", userStart: 1, rivalStart: 2 });
  await d.insert(s.rivalTaunts).values({ userId: me, assignmentId: asg!.id, codename: "RIVAL // ALPHA-1", message: "keep up", localDate: DAY });
  await d.insert(s.namedChallenges).values({
    challengerId: me,
    opponentId: b,
    domain: "BODY",
    days: 7,
    status: "resolved",
    respondBy: NOW,
    challengerStart: 10,
    opponentStart: 7771234.5,
    challengerEnd: 20,
    opponentEnd: 8881234.5,
    winnerId: b,
    outcome: "opponent_won",
  });
  const [duo] = await d.insert(s.duos).values({ userA: me, userB: b }).returning();
  await d.insert(s.duoMembers).values([
    { userId: me, duoId: duo!.id },
    { userId: b, duoId: duo!.id },
  ]);
  await d.insert(s.duoInvites).values({ fromId: me, toId: b, status: "accepted" });
  await d.insert(s.duoCheckins).values([
    { duoId: duo!.id, userId: me, kind: "done" },
    { duoId: duo!.id, userId: b, kind: "done" },
  ]);
  const [clan] = await d.insert(s.clans).values({ name: "Iron", nameLower: "iron", tag: "IRON", inviteCode: "SECRETINVITE1", createdBy: b }).returning();
  await d.insert(s.clanMembers).values([
    { userId: me, clanId: clan!.id, role: "member" },
    { userId: b, clanId: clan!.id, role: "leader" },
  ]);
  await d.insert(s.clanDispatches).values([
    { clanId: clan!.id, kind: "shame", text: "shamed", actorId: b, subjectId: me },
    { clanId: clan!.id, kind: "shame", text: "unrelated", actorId: b, subjectId: c },
  ]);
  // Secrets that must never leave.
  await d.insert(s.pushTokens).values({ userId: me, token: "ExponentPushToken[SECRETDEVICE]", platform: "ios" });
  await d.insert(s.idempotencyKeys).values({ userId: me, key: "idem-secret-1" });
  await d.insert(s.emailCodes).values({ userId: me, purpose: "verify", codeHash: "CODEHASH-SECRET", expiresAt: NOW });
}

test("export needs a session", { skip }, async () => {
  assert.equal((await request(app()).get("/api/account/export")).status, 401);
});

test("export of a user with every kind of data: own data only, other users as handles, no secrets, no hidden score", { skip }, async () => {
  const a = app({ now: () => NOW });
  const me = await setup(a);
  const b = await setup(a, { email: "bob@example.com", username: "bob_1" });
  const c = await setup(a, { email: "carol@example.com", username: "carol_1" });
  await seedEverything(me.id, b.id, c.id);
  const [mine] = await db!.select({ passwordHash: s.users.passwordHash }).from(s.users).where(eq(s.users.id, me.id));
  const refresh = await db!.select({ h: s.refreshTokens.tokenHash }).from(s.refreshTokens).where(eq(s.refreshTokens.userId, me.id));
  assert.ok(refresh.length > 0);

  const res = await request(a).get("/api/account/export").set(auth(me.token));
  assert.equal(res.status, 200);
  assert.equal(res.headers["content-disposition"], 'attachment; filename="system-self-export-2026-03-04.json"');
  assert.match(res.headers["content-type"] ?? "", /application\/json/);
  const text = res.text;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const doc = JSON.parse(text) as { meta: { userId: string; truncatedTables: string[] }; data: Record<string, any> };
  assert.equal(doc.meta.userId, me.id);
  assert.deepEqual(doc.meta.truncatedTables, []);

  // Every exported table actually carries data for this user, so a loader that silently returns nothing fails here.
  for (const name of Object.keys(EXPORT_TABLES)) {
    const v = doc.data[name];
    const empty = Array.isArray(v) ? v.length === 0 : !v || Object.values(v).every((x) => (Array.isArray(x) ? x.length === 0 : !x));
    assert.ok(!empty, `${name} is empty in the export`);
  }

  // No other user's id anywhere; the safety net also caught the ids planted in free-form JSON.
  for (const other of [b.id, c.id]) assert.ok(!text.includes(other), `other user id ${other} leaked`);
  assert.ok(text.includes("[REDACTED]"));

  // No secrets, no hashes, no hidden score.
  for (const secret of [mine!.passwordHash, ...refresh.map((r) => r.h), "CODEHASH-SECRET", "SECRETDEVICE", "idem-secret-1", "SECRETINVITE1", "reporter-secret", "THEIRS-9"]) {
    assert.ok(!text.includes(secret), `secret leaked: ${secret}`);
  }
  assert.doesNotMatch(JSON.stringify(doc.data), /password|token_?hash|code_?hash|secret|"hidden"|inviteCode|createdBy|tokenVersion/i);
  assert.ok(!text.includes("31.337"));
  assert.ok(!text.includes("7771234") && !text.includes("8881234"), "the opponent's challenge numbers leaked");

  // Own side only, other players as handles.
  assert.equal(doc.data.users.length, 1);
  assert.equal(doc.data.users[0].email, "alice@example.com");
  assert.equal(doc.data.clan_members.length, 1);
  assert.equal(doc.data.clans.length, 1);
  assert.equal(doc.data.clan_dispatches.length, 1);
  assert.equal(doc.data.clan_dispatches[0].actor, "bob_1");
  assert.equal(doc.data.duos[0].partner, "bob_1");
  assert.equal(doc.data.named_challenges[0].opponent, "bob_1");
  assert.equal(doc.data.named_challenges[0].myStart, 10);
  assert.equal(doc.data.named_challenges[0].won, false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rival = doc.data.rival_assignments.find((r: any) => r.slot === 1);
  assert.equal(rival.rival, "RIVAL // ALPHA-1");
  assert.equal(doc.data.rival_assignments.length, 2);
  assert.equal(doc.data.peer_ratings.length, 1);
  assert.equal(doc.data.peer_ratings[0].ratee, "bob_1");
  assert.equal(doc.data.peer_rating_weeks[0].ratingCount, 2);
  assert.equal(doc.data.follows.following.length, 1);
  assert.equal(doc.data.follows.followerCount, 1);
  assert.equal(doc.data.blocks.length, 1);
  assert.equal(doc.data.user_reports.length, 1);
  assert.equal(doc.data.billing_events[0].type, "INITIAL_PURCHASE");
  assert.equal(doc.data.daily_snapshots[0].hidden, undefined);
  // Session and device metadata, without any hash or token.
  assert.ok(doc.data.refresh_tokens.length > 0);
  assert.deepEqual(Object.keys(doc.data.refresh_tokens[0]).sort(), ["createdAt", "expiresAt", "revokedAt", "revokedReason", "userAgent"]);
  assert.deepEqual(Object.keys(doc.data.push_tokens[0]).sort(), ["createdAt", "lastSeenAt", "platform"]);
});

test("a deleted opponent is exported as FORMER OPERATOR, never an id", { skip }, async () => {
  const a = app({ now: () => NOW });
  const me = await setup(a);
  const b = await setup(a, { email: "bob@example.com", username: "bob_1" });
  await db!.insert(s.namedChallenges).values({ challengerId: me.id, opponentId: b.id, domain: "BODY", days: 7, status: "active", respondBy: NOW });
  await db!.delete(s.users).where(eq(s.users.id, b.id));
  const res = await request(a).get("/api/account/export").set(auth(me.token));
  assert.equal(res.status, 200);
  assert.ok(!res.text.includes(b.id));
  const doc = JSON.parse(res.text);
  assert.equal(doc.data.named_challenges.length, 1);
  assert.equal(doc.data.named_challenges[0].opponent, "FORMER OPERATOR");
});

test("a former clanmate is shown by public handle, never by username", { skip }, async () => {
  const a = app({ now: () => NOW });
  const me = await setup(a);
  const b = await setup(a, { email: "bob@example.com", username: "bob_1" });
  const [clan] = await db!.insert(s.clans).values({ name: "Iron", nameLower: "iron", tag: "IRON", inviteCode: "INV12345678" }).returning();
  await db!.insert(s.clanMembers).values([
    { userId: me.id, clanId: clan!.id, role: "leader" },
    { userId: b.id, clanId: clan!.id, role: "member" },
  ]);
  await db!.insert(s.peerRatings).values({ raterId: me.id, rateeId: b.id, weekKey: WEEK, rating: 4 });
  await db!.insert(s.clanDispatches).values({ clanId: clan!.id, kind: "shame", text: "x", actorId: b.id, subjectId: me.id });
  // B leaves the clan (B is an anonymous user: only the codename is public).
  await db!.delete(s.clanMembers).where(eq(s.clanMembers.userId, b.id));
  const [prof] = await db!.select({ c: s.profiles.publicCodename }).from(s.profiles).where(eq(s.profiles.userId, b.id));
  const res = await request(a).get("/api/account/export").set(auth(me.token));
  const doc = JSON.parse(res.text);
  assert.ok(!res.text.includes("bob_1"), "ex-clanmate username leaked");
  assert.equal(doc.data.peer_ratings[0].ratee, prof!.c);
  assert.equal(doc.data.clan_dispatches[0].actor, prof!.c);
});

test("an export with more than 70k distinct ids still works (the id sweep is one array parameter)", { skip }, async () => {
  const a = app({ now: () => NOW });
  const me = await setup(a);
  await db!.execute(sql`insert into logs (user_id, client_id, domain, log_type, occurred_at, local_date, free_text)
    select ${me.id}::uuid, 'bulk-' || g, 'BODY', 'workout', now(), '2026-03-04', gen_random_uuid()::text from generate_series(1, 70000) g`);
  await db!.execute(sql`insert into analytics_events (user_id, name) select ${me.id}::uuid, gen_random_uuid()::text from generate_series(1, 30000) g`);
  const res = await request(a).get("/api/account/export").set(auth(me.token));
  assert.equal(res.status, 200);
  const doc = JSON.parse(res.text);
  assert.equal(doc.data.logs.length, 50000); // capped, and reported as truncated
  assert.deepEqual(doc.meta.truncatedTables, ["logs"]);
  assert.equal(doc.data.analytics_events.length, 30000);
});

test("failed exports do not count against the hourly limit", { skip }, async () => {
  let failing = false;
  const flaky = new Proxy(db!, {
    get(target, prop) {
      if (prop === "transaction" && failing) return () => Promise.reject(new Error("boom"));
      const v = Reflect.get(target, prop, target);
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
  const a = createApp({ db: flaky, mailer: { async send() {} }, now: () => NOW });
  const me = await setup(a as never);
  failing = true;
  for (let i = 0; i < EXPORT_RATE_LIMIT_MAX + 1; i += 1) {
    assert.equal((await request(a).get("/api/account/export").set(auth(me.token))).status, 500);
  }
  failing = false;
  assert.equal((await request(a).get("/api/account/export").set(auth(me.token))).status, 200);
});

test("export is rate limited per user", { skip }, async () => {
  const a = app({ now: () => NOW });
  const me = await setup(a);
  const other = await setup(a, { email: "bob@example.com", username: "bob_1" });
  for (let i = 0; i < EXPORT_RATE_LIMIT_MAX; i += 1) {
    assert.equal((await request(a).get("/api/account/export").set(auth(me.token))).status, 200);
  }
  const limited = await request(a).get("/api/account/export").set(auth(me.token));
  assert.equal(limited.status, 429);
  assert.equal(limited.body.code, "rate_limited");
  // Another user is not affected by the first user's bucket.
  assert.equal((await request(a).get("/api/account/export").set(auth(other.token))).status, 200);
});
