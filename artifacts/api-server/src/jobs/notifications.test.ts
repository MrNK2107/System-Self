import test, { after, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { closeTestDb, resetDb } from "@workspace/db/testing";
import { notices, noticePushes, notificationLog, notificationPrefs, pushTokens, quests } from "@workspace/db";
import request from "supertest";
import { app, assertStoredNoticesMatchContract, auth, db, setup, skip } from "../routes/game-test-helpers";
import { runWorkerTick } from "./run-loop";
import { createQuestDeadlineNotices, dispatchPushes, runNotificationJobs } from "./notifications";
import { PUSH_PRIORITY, pushCopy } from "../services/push-policy";
import type { PushMessage, PushTicket } from "../services/push";

after(async () => {
  await closeTestDb();
});
afterEach(async () => {
  await assertStoredNoticesMatchContract();
});
beforeEach(async () => {
  if (db) await resetDb(db);
});

// 13:30 in Asia/Kolkata (the test users' timezone), 2026-10-19.
const NOW = new Date("2026-10-19T08:00:00Z");
const TOKEN = "ExponentPushToken[device1]";

const PAYLOADS: Record<string, object> = {
  rank_change: { from: "E", to: "D", kind: "promotion", newCodename: "VECTOR // AB1-2" },
  shadow_activated: { gap: 12, codename: "SHADOW // ALICE_1" },
  rival_passed: { codename: "VECTOR // AB1-2", domain: "BODY" },
  raid_result: { weekKey: "2026-W42", week: 42, type: "domain", position: 2, count: 8, won: false, value: null, rivalValue: null, bonus: 0, line: "x" },
  quest_deadline_24h: { count: 3, localDate: "2026-10-19" },
  challenge_result: { challengeId: "c1", handle: "bob_1", domain: "BODY", days: 7, outcome: "win", myGain: 2, theirGain: 1, delta: 0.5 },
  duo_checkin: { handle: "bob_1", kind: "done" },
};

function fakeTransport() {
  const sent: PushMessage[] = [];
  const transport = async (ms: PushMessage[]): Promise<PushTicket[]> => {
    sent.push(...ms);
    return ms.map(() => ({ status: "ok" as const, id: "r" }));
  };
  return { sent, transport };
}

async function user(prefs?: { morning?: boolean; nightly?: boolean; events?: boolean }, who = { email: "alice@example.com", username: "alice_1" }) {
  const u = await setup(app(), who);
  await db!.insert(pushTokens).values({ userId: u.id, token: `ExponentPushToken[${who.username}]`, platform: "ios" });
  if (prefs) await db!.insert(notificationPrefs).values({ userId: u.id, ...prefs });
  return u;
}

async function notice(userId: string, kind: string, at = new Date(NOW.getTime() - 60_000), payload?: object) {
  const [row] = await db!.insert(notices).values({ userId, kind, payload: payload ?? PAYLOADS[kind]!, createdAt: at }).returning();
  return row!;
}

const kindsSent = (sent: PushMessage[]) => sent.map((m) => (m.data as { kind: string }).kind);

test("Review Focus 3: morning and nightly on leaves one slot, so only the highest-priority event pushes", { skip }, async () => {
  const u = await user();
  await notice(u.id, "duo_checkin");
  await notice(u.id, "raid_result");
  await notice(u.id, "challenge_result");
  const top = await notice(u.id, "rank_change");
  const f = fakeTransport();
  await dispatchPushes(db!, NOW, f.transport);
  assert.deepEqual(kindsSent(f.sent), ["rank_change"]);
  assert.equal(f.sent[0]!.body, "Rank promotion. E → D.");
  assert.equal(f.sent[0]!.to, "ExponentPushToken[alice_1]");
  const log = await db!.select().from(notificationLog).where(eq(notificationLog.userId, u.id));
  assert.deepEqual(log.map((l) => [l.kind, l.localDate]), [["rank_change", "2026-10-19"]]);
  // The dropped events stay as in-app notices, unseen.
  const rows = await db!.select().from(notices).where(eq(notices.userId, u.id));
  assert.equal(rows.length, 4);
  assert.ok(rows.every((r) => r.seenAt === null));
  const decisions = await db!.select().from(noticePushes).where(eq(noticePushes.userId, u.id));
  assert.equal(decisions.length, 4);
  assert.equal(decisions.find((d) => d.noticeId === top.id)!.decision, "sent");
  assert.equal(decisions.filter((d) => d.decision === "dropped").length, 3);
});

test("event slots grow when the reminders are off: 3 - morning - nightly", { skip }, async () => {
  const cases: [{ morning: boolean; nightly: boolean }, string[]][] = [
    [{ morning: true, nightly: true }, ["rank_change"]],
    [{ morning: false, nightly: true }, ["rank_change", "shadow_activated"]],
    [{ morning: true, nightly: false }, ["rank_change", "shadow_activated"]],
    [{ morning: false, nightly: false }, ["rank_change", "shadow_activated", "rival_passed"]],
  ];
  for (const [prefs, expected] of cases) {
    await resetDb(db!);
    const u = await user({ ...prefs, events: true });
    for (const k of ["duo_checkin", "challenge_result", "raid_result", "rival_passed", "shadow_activated", "rank_change"]) await notice(u.id, k);
    const f = fakeTransport();
    await dispatchPushes(db!, NOW, f.transport);
    assert.deepEqual(kindsSent(f.sent), expected, JSON.stringify(prefs));
  }
});

test("priority order: rank_change > shadow_activated > rival_passed > raid_result > quest_deadline_24h > challenge_result > duo_checkin", { skip }, async () => {
  assert.deepEqual([...PUSH_PRIORITY], [
    "rank_change",
    "shadow_activated",
    "rival_passed",
    "raid_result",
    "quest_deadline_24h",
    "challenge_result",
    "duo_checkin",
  ]);
  const order = [...PUSH_PRIORITY];
  for (let drop = 0; drop < order.length; drop++) {
    await resetDb(db!);
    const u = await user({ morning: false, nightly: false, events: true });
    // Created lowest priority first, so creation order never decides.
    const present = order.slice(drop);
    for (const k of [...present].reverse()) await notice(u.id, k);
    const f = fakeTransport();
    await dispatchPushes(db!, NOW, f.transport);
    assert.deepEqual(kindsSent(f.sent), present.slice(0, 3));
  }
});

test("events off: no event pushes at all, the notices stay in-app", { skip }, async () => {
  const u = await user({ morning: false, nightly: false, events: false });
  await notice(u.id, "rank_change");
  await notice(u.id, "raid_result");
  const f = fakeTransport();
  await dispatchPushes(db!, NOW, f.transport);
  assert.equal(f.sent.length, 0);
  assert.equal((await db!.select().from(notificationLog)).length, 0);
  assert.equal((await db!.select().from(notices)).length, 2);
  // Turning events back on later does not resurrect them.
  await db!.update(notificationPrefs).set({ events: true });
  await dispatchPushes(db!, NOW, f.transport);
  assert.equal(f.sent.length, 0);
});

test("a filled slot stays filled: a later, higher-priority event the same day is dropped", { skip }, async () => {
  const u = await user();
  await notice(u.id, "duo_checkin");
  const f = fakeTransport();
  await dispatchPushes(db!, NOW, f.transport);
  assert.deepEqual(kindsSent(f.sent), ["duo_checkin"]);
  const later = new Date(NOW.getTime() + 3600_000);
  await notice(u.id, "rank_change", new Date(later.getTime() - 1000));
  await dispatchPushes(db!, later, f.transport);
  assert.deepEqual(kindsSent(f.sent), ["duo_checkin"]);
  assert.equal((await db!.select().from(notificationLog)).length, 1);
});

test("a new local day resets the cap, and the log is keyed by the user's local date", { skip }, async () => {
  const u = await user();
  await notice(u.id, "rank_change");
  const f = fakeTransport();
  await dispatchPushes(db!, NOW, f.transport);
  const next = new Date(NOW.getTime() + 24 * 3600_000);
  await notice(u.id, "shadow_activated", new Date(next.getTime() - 1000));
  await dispatchPushes(db!, next, f.transport);
  assert.deepEqual(kindsSent(f.sent), ["rank_change", "shadow_activated"]);
  const log = await db!.select().from(notificationLog);
  assert.deepEqual(log.map((l) => l.localDate).sort(), ["2026-10-19", "2026-10-20"]);
});

test("local date follows the user's timezone: 20:00Z is already tomorrow in Asia/Kolkata", { skip }, async () => {
  const u = await user();
  const lateUtc = new Date("2026-10-19T20:00:00Z");
  await notice(u.id, "rank_change", new Date(lateUtc.getTime() - 1000));
  await dispatchPushes(db!, lateUtc, fakeTransport().transport);
  assert.equal((await db!.select().from(notificationLog))[0]!.localDate, "2026-10-20");
});

test("dispatch is once per notice; users without a device spend no slot and send nothing", { skip }, async () => {
  const u = await user();
  await notice(u.id, "rank_change");
  const f = fakeTransport();
  await dispatchPushes(db!, NOW, f.transport);
  await dispatchPushes(db!, NOW, f.transport);
  assert.equal(f.sent.length, 1);

  await resetDb(db!);
  const bare = await setup(app());
  await notice(bare.id, "rank_change");
  const g = fakeTransport();
  await dispatchPushes(db!, NOW, g.transport);
  assert.equal(g.sent.length, 0);
  assert.equal((await db!.select().from(notificationLog)).length, 0);
  // The slot was never spent: a device registered later still gets the next event.
  await db!.insert(pushTokens).values({ userId: bare.id, token: TOKEN, platform: "android" });
  await notice(bare.id, "raid_result", new Date(NOW.getTime() - 1000));
  await dispatchPushes(db!, NOW, g.transport);
  assert.deepEqual(kindsSent(g.sent), ["raid_result"]);
});

test("every device of the user gets the one push, which is one log row; badge is 0", { skip }, async () => {
  const u = await user();
  await db!.insert(pushTokens).values({ userId: u.id, token: TOKEN, platform: "android" });
  await notice(u.id, "rank_change");
  const f = fakeTransport();
  await dispatchPushes(db!, NOW, f.transport);
  assert.equal(f.sent.length, 2);
  assert.ok(f.sent.every((m) => m.badge === 0 && m.title === "SYSTEM // SELF"));
  assert.equal((await db!.select().from(notificationLog)).length, 1);
});

test("stale (over 24 h) and already-seen notices never push; other users are unaffected", { skip }, async () => {
  const a = await user();
  const b = await user(undefined, { email: "bob@example.com", username: "bob_1" });
  await notice(a.id, "rank_change", new Date(NOW.getTime() - 25 * 3600_000));
  const seen = await notice(a.id, "shadow_activated");
  await db!.update(notices).set({ seenAt: NOW }).where(eq(notices.id, seen.id));
  await notice(b.id, "raid_result");
  const f = fakeTransport();
  await dispatchPushes(db!, NOW, f.transport);
  assert.deepEqual(f.sent.map((m) => [m.to, (m.data as { kind: string }).kind]), [["ExponentPushToken[bob_1]", "raid_result"]]);
});

test("non-push kinds never push", { skip }, async () => {
  const u = await user({ morning: false, nightly: false, events: true });
  await notice(u.id, "gym_unlocked", undefined, { line: "x" });
  await notice(u.id, "shadow_resolved", undefined, { codename: "S" });
  const f = fakeTransport();
  await dispatchPushes(db!, NOW, f.transport);
  assert.equal(f.sent.length, 0);
});

test("a dead device is removed after dispatch and the push is still logged", { skip }, async () => {
  const u = await user();
  await notice(u.id, "rank_change");
  const transport = async (ms: PushMessage[]): Promise<PushTicket[]> =>
    ms.map(() => ({ status: "error" as const, details: { error: "DeviceNotRegistered" } }));
  await dispatchPushes(db!, NOW, transport);
  assert.equal((await db!.select().from(pushTokens)).length, 0);
  assert.equal((await db!.select().from(notificationLog)).length, 1);
});

test("copy is verbatim", () => {
  const c = (k: string, p: object) => pushCopy(k as never, p as never);
  assert.equal(c("rank_change", PAYLOADS.rank_change!), "Rank promotion. E → D.");
  assert.equal(
    c("rank_change", { from: "C", to: "D", kind: "demotion", newCodename: "x" }),
    "Rank demotion. C → D. Your score fell below threshold for 7 consecutive days.",
  );
  assert.equal(c("shadow_activated", PAYLOADS.shadow_activated!), "Shadow Self initialized. Gap: 12 points. It will not wait for you.");
  assert.equal(c("shadow_activated", { gap: 12.34, codename: "x" }), "Shadow Self initialized. Gap: 12.3 points. It will not wait for you.");
  assert.equal(c("rival_passed", PAYLOADS.rival_passed!), "VECTOR // AB1-2 moved past you in BODY.");
  assert.equal(c("raid_result", PAYLOADS.raid_result!), "RAID RESULT — Week 42. Your clan placed 2 of 8.");
  assert.equal(c("quest_deadline_24h", PAYLOADS.quest_deadline_24h!), "3 quests expire tonight.");
  assert.equal(c("challenge_result", PAYLOADS.challenge_result!), "Challenge resolved. You won.");
  assert.equal(c("quest_deadline_24h", { count: 1, localDate: "2026-10-19" }), "1 quest expires tonight.");
  assert.equal(c("duo_checkin", PAYLOADS.duo_checkin!), "Duo partner is done.");
  assert.equal(c("duo_checkin", { handle: "bob_1", kind: "going_now" }), "Duo partner is going now.");
  assert.equal(c("duo_checkin", { handle: "bob_1", kind: "checked_in" }), "Duo partner checked in.");
});

// --- quest_deadline_24h ---------------------------------------------------------------------------------------

const EVENING = new Date("2026-10-19T12:30:00Z"); // 18:00 Asia/Kolkata
const TONIGHT = new Date("2026-10-19T18:29:00Z"); // 23:59 local
const TOMORROW = new Date("2026-10-20T18:29:00Z");
const quest = (userId: string, o: Partial<typeof quests.$inferInsert> = {}): typeof quests.$inferInsert => ({
  userId,
  type: "daily",
  title: "Q",
  description: "D",
  domain: "BODY",
  expiresAt: TONIGHT,
  ...o,
});
const deadlineNotices = (userId: string) =>
  db!.select().from(notices).where(and(eq(notices.userId, userId), eq(notices.kind, "quest_deadline_24h")));

test("deadline notice at local 18:00 counts active non-bonus quests expiring tonight, once per local day", { skip }, async () => {
  const u = await user();
  await db!.insert(quests).values([
    quest(u.id),
    quest(u.id),
    quest(u.id, { bonus: true }),
    quest(u.id, { expiresAt: TOMORROW, type: "weekly" }),
    quest(u.id, { status: "complete" }),
    quest(u.id, { status: "failed" }),
  ]);
  assert.equal(await createQuestDeadlineNotices(db!, new Date(EVENING.getTime() - 60_000)), 0);
  assert.equal((await deadlineNotices(u.id)).length, 0);
  assert.equal(await createQuestDeadlineNotices(db!, EVENING), 1);
  const [n] = await deadlineNotices(u.id);
  assert.deepEqual(n!.payload, { count: 2, localDate: "2026-10-19" });
  assert.equal(await createQuestDeadlineNotices(db!, new Date(EVENING.getTime() + 3600_000)), 0);
  assert.equal((await deadlineNotices(u.id)).length, 1);
});

test("bonus quests alone never produce a deadline notice", { skip }, async () => {
  const u = await user();
  await db!.insert(quests).values([quest(u.id, { bonus: true }), quest(u.id, { bonus: true })]);
  assert.equal(await createQuestDeadlineNotices(db!, EVENING), 0);
  assert.equal((await deadlineNotices(u.id)).length, 0);
});

test("a deadline notice is a push candidate: it dispatches as `{count} quests expire tonight.`", { skip }, async () => {
  const u = await user();
  await db!.insert(quests).values([quest(u.id), quest(u.id)]);
  await createQuestDeadlineNotices(db!, EVENING);
  const f = fakeTransport();
  await dispatchPushes(db!, EVENING, f.transport);
  assert.deepEqual(f.sent.map((m) => m.body), ["2 quests expire tonight."]);
});

test("runNotificationJobs creates the deadline notice and pushes it in the same pass", { skip }, async () => {
  const u = await user();
  await db!.insert(quests).values(quest(u.id));
  const f = fakeTransport();
  const out = await runNotificationJobs(db!, EVENING, f.transport);
  assert.equal(out.deadline, 1);
  assert.deepEqual(f.sent.map((m) => m.body), ["1 quest expires tonight."]);
});

test("no deadline notice is created from 23:00 local", { skip }, async () => {
  const u = await user();
  await db!.insert(quests).values(quest(u.id));
  assert.equal(await createQuestDeadlineNotices(db!, new Date("2026-10-19T17:30:00Z")), 0); // 23:00 IST
  assert.equal(await createQuestDeadlineNotices(db!, new Date("2026-10-19T17:29:00Z")), 1); // 22:59 IST
});

test("a deadline notice from yesterday's local date is skipped, not pushed, at the next day's first tick", { skip }, async () => {
  const u = await user();
  const n = await notice(u.id, "quest_deadline_24h", new Date("2026-10-19T18:29:30Z")); // 23:59:30 IST
  const f = fakeTransport();
  await dispatchPushes(db!, new Date("2026-10-19T18:30:30Z"), f.transport); // 00:00:30 IST next day
  assert.equal(f.sent.length, 0);
  assert.equal((await db!.select().from(notificationLog)).length, 0);
  const [d] = await db!.select().from(noticePushes).where(eq(noticePushes.noticeId, n.id));
  assert.equal(d!.decision, "skipped");
});

test("turning a reminder off after it fired keeps its slot reserved for the day", { skip }, async () => {
  const clock = { now: NOW }; // 13:30 IST: the 06:30 morning reminder has fired, the 21:30 nightly has not
  const a = app({ now: () => clock.now });
  const u = await setup(a, { email: "p@example.com", username: "p_1" });
  await db!.insert(pushTokens).values({ userId: u.id, token: "ExponentPushToken[p]", platform: "ios" });
  const put = (b: object) => request(a).put("/api/notifications/prefs").set(auth(u.token)).send(b);
  assert.equal((await put({ morning: false, nightly: false })).status, 200);
  const log = await db!.select().from(notificationLog).where(eq(notificationLog.userId, u.id));
  assert.deepEqual(log.map((l) => [l.kind, l.localDate]), [["reminder_morning", "2026-10-19"]]);
  // Repeating the PUT does not add a second row.
  await put({ morning: false });
  assert.equal((await db!.select().from(notificationLog).where(eq(notificationLog.userId, u.id))).length, 1);
  // Both reminders are off, one is reserved: 2 event slots left today.
  for (const k of ["rank_change", "shadow_activated", "rival_passed"]) await notice(u.id, k);
  const f = fakeTransport();
  await dispatchPushes(db!, NOW, f.transport);
  assert.deepEqual(kindsSent(f.sent), ["rank_change", "shadow_activated"]);
});

test("turning a reminder back on counts its slot once, never twice", { skip }, async () => {
  const a = app({ now: () => NOW });
  const u = await setup(a, { email: "q@example.com", username: "q_1" });
  await db!.insert(pushTokens).values({ userId: u.id, token: "ExponentPushToken[q]", platform: "ios" });
  const put = (b: object) => request(a).put("/api/notifications/prefs").set(auth(u.token)).send(b);
  await put({ morning: false });
  await put({ morning: true });
  for (const k of ["rank_change", "shadow_activated"]) await notice(u.id, k);
  const f = fakeTransport();
  await dispatchPushes(db!, NOW, f.transport);
  assert.deepEqual(kindsSent(f.sent), ["rank_change"]); // morning + nightly on: one event slot
});

test("an off-toggle before the reminder's time reserves nothing", { skip }, async () => {
  const a = app({ now: () => NOW });
  const u = await setup(a, { email: "r@example.com", username: "r_1" });
  await request(a).put("/api/notifications/prefs").set(auth(u.token)).send({ nightly: false }); // 21:30 not reached
  assert.equal((await db!.select().from(notificationLog)).length, 0);
});

test("the worker prunes push decisions and log rows older than 30 days", { skip }, async () => {
  const u = await user();
  const old = new Date(NOW.getTime() - 31 * 86_400_000);
  const fresh = new Date(NOW.getTime() - 29 * 86_400_000);
  const [oldN, freshN] = [await notice(u.id, "rank_change", old), await notice(u.id, "rank_change", fresh)];
  await db!.insert(noticePushes).values([
    { noticeId: oldN.id, userId: u.id, decision: "sent", decidedAt: old },
    { noticeId: freshN.id, userId: u.id, decision: "sent", decidedAt: fresh },
  ]);
  await db!.insert(notificationLog).values([
    { userId: u.id, localDate: "2026-09-18", kind: "rank_change", sentAt: old },
    { userId: u.id, localDate: "2026-09-20", kind: "rank_change", sentAt: fresh },
  ]);
  await runWorkerTick(db!, NOW, undefined, 200, fakeTransport().transport);
  assert.deepEqual((await db!.select().from(noticePushes)).map((r) => r.noticeId), [freshN.id]);
  assert.deepEqual((await db!.select().from(notificationLog)).map((r) => r.localDate), ["2026-09-20"]);
});
