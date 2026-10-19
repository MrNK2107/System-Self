import test, { after, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { closeTestDb, resetDb } from "@workspace/db/testing";
import { clanDispatches, clanMembers, clanRaids, clans, dailySnapshots, jobRuns, logs, notices, quests, users, workoutSessions } from "@workspace/db";
import { MyClanResponseSchema, RaidResponseSchema } from "@workspace/contracts";
import { app, assertContract, assertStoredNoticesMatchContract, auth, db, setup, skip, TZ } from "./game-test-helpers";
import { env } from "../lib/env";
import { resolveWeeklyRaids, runSocialJobs, startWeeklyRaids } from "../jobs/social";
import { resolveRaidGroup } from "../services/raids";

after(async () => {
  await closeTestDb();
});
afterEach(async () => {
  await assertStoredNoticesMatchContract();
});
beforeEach(async () => {
  if (db) await resetDb(db);
});

// ISO weeks used (UTC Monday): W44 domain 2026-10-26, W45 discipline 11-02, W46 body 11-09, W47 score 11-16.
const W44_MON = new Date("2026-10-26T00:00:00Z");
const W44_CLOSE = new Date("2026-11-02T00:00:00Z"); // the span is [Mon 00:00, next Mon 00:00); raids resolve at the close
const OLD_JOIN = new Date("2026-09-01T00:00:00Z");

let n = 0;
const nextUser = async (joinClan?: string, joinedAt = OLD_JOIN) => {
  const [u] = await db!
    .insert(users)
    .values({ email: `r${n}@x.com`, passwordHash: "h", username: `raider_${n++}`, birthYear: 1990, timezone: TZ, termsAcceptedAt: new Date() })
    .returning();
  if (joinClan) await db!.insert(clanMembers).values({ userId: u!.id, clanId: joinClan, role: "member", joinedAt });
  return u!.id;
};

interface TestClan {
  id: string;
  members: string[];
}
/** A clan with `size` members (the first leads) who all joined before the raid weeks. */
async function mkClan(name: string, rank: number | null, size = 3, status = "active"): Promise<TestClan> {
  const [c] = await db!
    .insert(clans)
    .values({
      name,
      nameLower: name.toLowerCase(),
      tag: "RD",
      inviteCode: `C${String(n++).padStart(7, "0")}`,
      status,
      clanRank: rank,
      clanScore: rank ? 50 : null,
      activeMemberCount: size,
    })
    .returning();
  const members: string[] = [];
  for (let i = 0; i < size; i++) {
    const id = await nextUser();
    await db!.insert(clanMembers).values({ userId: id, clanId: c!.id, role: i === 0 ? "leader" : "member", joinedAt: OLD_JOIN });
    members.push(id);
  }
  return { id: c!.id, members };
}

let logN = 0;
async function addLog(userId: string, at: string, domain = "MIND", forbidden = false) {
  await db!.insert(logs).values({ userId, clientId: `l${logN++}`, domain, logType: "x", forbidden, occurredAt: new Date(at), localDate: at.slice(0, 10) });
}
/** Every member logs inside the activity window that precedes the close of week 44, so all count as active. */
const keepActive = async (c: TestClan) => {
  for (const m of c.members) await addLog(m, "2026-10-30T10:00:00Z", "SOCIAL");
};

const raidRows = (weekKey = "2026-W44") => db!.select().from(clanRaids).where(eq(clanRaids.weekKey, weekKey));
const clanRow = async (id: string) => (await db!.select().from(clans).where(eq(clans.id, id)))[0]!;
const raidNotices = (userId: string) => db!.select().from(notices).where(and(eq(notices.userId, userId), eq(notices.kind, "raid_result")));
const dispatchText = async (clanId: string) =>
  (await db!.select().from(clanDispatches).where(and(eq(clanDispatches.clanId, clanId), eq(clanDispatches.kind, "raid"))))[0]!.text;

// --- start -------------------------------------------------------------------------------------

test("start: 5 active clans make groups of 3 and 2; forming, unranked and a lone clan are left out; once per week", { skip }, async () => {
  for (let i = 1; i <= 5; i++) await mkClan(`Clan${i}`, i);
  await mkClan("Forming", null, 3, "forming");
  await mkClan("NoScore", null, 3, "active");
  assert.equal(await startWeeklyRaids(db!, new Date("2026-10-28T09:00:00Z")), 5);
  const rows = await raidRows();
  assert.equal(rows.length, 5);
  assert.ok(rows.every((r) => r.type === "domain" && r.resolvedAt === null));
  const byGroup = new Map<string, number>();
  for (const r of rows) byGroup.set(r.groupId, (byGroup.get(r.groupId) ?? 0) + 1);
  assert.deepEqual([...byGroup.values()].sort(), [2, 3]);
  assert.equal(await startWeeklyRaids(db!, new Date("2026-10-29T09:00:00Z")), "not_due");
  assert.equal((await raidRows()).length, 5);
  assert.equal((await db!.select().from(jobRuns).where(eq(jobRuns.job, "raid-start")))[0]!.lastRunDate, "2026-10-26");
  assert.equal(await startWeeklyRaids(db!, new Date("2026-11-02T00:00:00Z")), 5);
  assert.equal((await raidRows("2026-W45"))[0]!.type, "discipline");
});

test("start: a single active clan has no raid; forming clans never raid", { skip }, async () => {
  await mkClan("Solo", 1);
  await mkClan("Forming", null, 3, "forming");
  assert.equal(await startWeeklyRaids(db!, W44_MON), 0);
  assert.equal((await raidRows()).length, 0);
});

// --- resolution --------------------------------------------------------------------------------

async function twoClans() {
  const a = await mkClan("Alpha", 1, 3);
  const b = await mkClan("Bravo", 2, 3);
  await keepActive(a);
  await keepActive(b);
  await startWeeklyRaids(db!, W44_MON);
  return { a, b };
}

test("domain raid: MIND logs in the week count; forbidden, out-of-week and late joiners do not; winner gets +2.0 x active members; notices go to all members", { skip }, async () => {
  const { a, b } = await twoClans();
  const [m0, m1] = a.members as [string, string];
  await addLog(m0, "2026-10-27T10:00:00Z");
  await addLog(m0, "2026-10-28T10:00:00Z");
  await addLog(m1, "2026-11-01T23:59:30Z"); // Sunday's last minute still counts
  await addLog(m1, "2026-10-28T10:00:00Z", "MIND", true); // forbidden
  await addLog(m1, "2026-10-25T23:00:00Z"); // the week before
  const late = await nextUser(a.id, new Date("2026-10-28T00:00:00Z")); // joined mid-week
  await addLog(late, "2026-10-29T10:00:00Z");
  await addLog(b.members[0]!, "2026-10-27T10:00:00Z");
  await addLog(b.members[0]!, "2026-10-28T10:00:00Z", "BODY"); // wrong domain

  assert.equal(await resolveWeeklyRaids(db!, new Date("2026-11-01T23:59:30Z")), 0); // the span is still open: nothing is due
  assert.equal((await raidRows()).every((r) => !r.resolvedAt), true);

  assert.equal(await resolveWeeklyRaids(db!, W44_CLOSE), 1);
  const rows = await raidRows();
  const ra = rows.find((r) => r.clanId === a.id)!;
  const rb = rows.find((r) => r.clanId === b.id)!;
  assert.deepEqual([ra.metricValue, ra.position, ra.winner], [3, 1, true]);
  assert.deepEqual([rb.metricValue, rb.position, rb.winner], [1, 2, false]);

  const ca = await clanRow(a.id);
  // 3 founding members are active, and so is the late joiner (logged in the window): 4 x 2.0
  assert.equal(ca.raidBonus, 8);
  assert.equal(ca.raidBonusMonth, "2026-11");
  assert.equal(ca.raidWins, 1);
  assert.equal(ca.clanScore, 58);
  assert.equal((await clanRow(b.id)).raidBonus, 0);
  assert.equal((await clanRow(b.id)).clanScore, 50);

  const lineA = await dispatchText(a.id);
  const lineB = await dispatchText(b.id);
  assert.equal(lineA, "RAID RESULT — WEEK 44. Your clan ranked 1 of 2. Mind logs: 3. Rival clan: 1. Gap: 2.");
  assert.equal(lineB, "RAID RESULT — WEEK 44. Your clan ranked 2 of 2. Mind logs: 1. Rival clan: 3. Gap: 2.");

  for (const m of [...a.members, late]) {
    const ns = await raidNotices(m);
    assert.equal(ns.length, 1);
    assert.deepEqual(ns[0]!.payload, { weekKey: "2026-W44", week: 44, type: "domain", position: 1, count: 2, won: true, value: 3, rivalValue: 1, bonus: 8, line: lineA });
  }
  for (const m of b.members) {
    const p = (await raidNotices(m))[0]!.payload as { won: boolean; position: number; bonus: number };
    assert.deepEqual([p.won, p.position, p.bonus], [false, 2, 0]);
  }
  assert.doesNotMatch(lineA + lineB, /\p{Extended_Pictographic}/u);
});

test("a second win in the same month adds to the raid bonus", { skip }, async () => {
  const { a } = await twoClans();
  await addLog(a.members[0]!, "2026-10-27T10:00:00Z");
  await resolveWeeklyRaids(db!, W44_CLOSE);
  assert.equal((await clanRow(a.id)).raidBonus, 6);
  const g = (await raidRows())[0]!.groupId;
  await db!.update(clanRaids).set({ resolvedAt: null }).where(eq(clanRaids.groupId, g));
  assert.equal(await resolveRaidGroup(db!, g, new Date("2026-11-02T00:10:00Z")), true);
  assert.equal((await clanRow(a.id)).raidBonus, 12);
  assert.equal((await clanRow(a.id)).raidWins, 2);
});

test("a tie for the lead has no winner and no bonus", { skip }, async () => {
  const { a, b } = await twoClans();
  await addLog(a.members[0]!, "2026-10-27T10:00:00Z");
  await addLog(b.members[0]!, "2026-10-27T10:00:00Z");
  await resolveWeeklyRaids(db!, W44_CLOSE);
  const rows = await raidRows();
  assert.ok(rows.every((r) => r.position === 1 && !r.winner && r.resolvedAt));
  assert.equal((await clanRow(a.id)).raidBonus, 0);
  assert.equal((await clanRow(a.id)).raidWins, 0);
  const ns = await raidNotices(a.members[0]!);
  assert.equal(ns.length, 1); // the result still goes out
  assert.equal((ns[0]!.payload as { won: boolean }).won, false);
});

test("resolution is idempotent: a repeat settles nothing and writes no second notice or bonus", { skip }, async () => {
  const { a } = await twoClans();
  await addLog(a.members[0]!, "2026-10-27T10:00:00Z");
  assert.equal(await resolveWeeklyRaids(db!, W44_CLOSE), 1);
  assert.equal(await resolveWeeklyRaids(db!, new Date("2026-11-02T00:05:00Z")), "not_due");
  const g = (await raidRows())[0]!.groupId;
  assert.equal(await resolveRaidGroup(db!, g, new Date("2026-11-02T00:06:00Z")), false);
  assert.equal((await raidNotices(a.members[0]!)).length, 1);
  assert.equal((await clanRow(a.id)).raidBonus, 6);
  assert.equal((await db!.select().from(clanDispatches).where(eq(clanDispatches.kind, "raid"))).length, 2);
});

test("two concurrent resolutions of one group settle it once", { skip }, async () => {
  const { a } = await twoClans();
  await addLog(a.members[0]!, "2026-10-27T10:00:00Z");
  const g = (await raidRows())[0]!.groupId;
  const res = await Promise.all([resolveRaidGroup(db!, g, W44_CLOSE), resolveRaidGroup(db!, g, W44_CLOSE)]);
  assert.deepEqual(res.slice().sort(), [false, true]);
  assert.equal((await clanRow(a.id)).raidWins, 1);
  assert.equal((await raidNotices(a.members[0]!)).length, 1);
});

test("resolution stops at its time budget after one group and the next tick resumes", { skip }, async () => {
  for (let i = 1; i <= 6; i++) await keepActive(await mkClan(`C${i}`, i, 3)); // groups of 4 and 2
  await startWeeklyRaids(db!, W44_MON);
  const frozen = () => 0;
  assert.equal(await resolveWeeklyRaids(db!, W44_CLOSE, { budgetMs: 0, nowMs: frozen }), 1);
  assert.equal((await db!.select().from(jobRuns).where(eq(jobRuns.job, "raid-resolve"))).length, 0);
  assert.equal(await resolveWeeklyRaids(db!, W44_CLOSE, { budgetMs: 0, nowMs: frozen }), 1);
  assert.equal((await db!.select().from(jobRuns).where(eq(jobRuns.job, "raid-resolve")))[0]!.lastRunDate, "2026-10-26");
  assert.ok((await raidRows()).every((r) => r.resolvedAt));
  assert.equal(await resolveWeeklyRaids(db!, W44_CLOSE, { budgetMs: 0, nowMs: frozen }), "not_due");
});

test("body raid counts BODY logs once: a gym session is its gym_session BODY log, not a second count", { skip }, async () => {
  const a = await mkClan("Alpha", 1);
  const b = await mkClan("Bravo", 2);
  await startWeeklyRaids(db!, new Date("2026-11-09T00:00:00Z")); // W46: body
  assert.equal((await raidRows("2026-W46"))[0]!.type, "body");
  const m0 = a.members[0]!;
  await addLog(m0, "2026-11-10T10:00:00Z", "BODY");
  // a completed gym session as the gym route writes it: a session row plus a BODY gym_session log
  await db!.insert(workoutSessions).values({ userId: m0, clientId: "s1", startedAt: new Date("2026-11-11T10:00:00Z"), completedAt: new Date("2026-11-11T11:00:00Z"), localDate: "2026-11-11" });
  await db!.insert(logs).values({ userId: m0, clientId: "gym:s1", domain: "BODY", logType: "gym_session", occurredAt: new Date("2026-11-11T11:00:00Z"), localDate: "2026-11-11" });
  await addLog(m0, "2026-11-12T10:00:00Z", "BODY", true); // forbidden
  await addLog(b.members[0]!, "2026-11-10T10:00:00Z", "MIND");
  await resolveWeeklyRaids(db!, new Date("2026-11-16T00:00:00Z"));
  const rows = await raidRows("2026-W46");
  assert.equal(rows.find((r) => r.clanId === a.id)!.metricValue, 2);
  assert.equal(rows.find((r) => r.clanId === b.id)!.metricValue, 0);
  assert.equal(rows.find((r) => r.clanId === a.id)!.winner, true);
});

test("discipline raid is the clan-wide quest completion rate", { skip }, async () => {
  const a = await mkClan("Alpha", 1);
  const b = await mkClan("Bravo", 2);
  await startWeeklyRaids(db!, new Date("2026-11-02T00:00:00Z")); // W45: discipline
  const q = (userId: string, status: string, at: string) =>
    db!.insert(quests).values({ userId, type: "daily", title: "t", description: "d", domain: "MIND", status, expiresAt: new Date(at), resolvedAt: new Date(at), resolvedLocalDate: at.slice(0, 10) });
  await q(a.members[0]!, "complete", "2026-11-03T10:00:00Z");
  await q(a.members[1]!, "complete", "2026-11-04T10:00:00Z");
  await q(a.members[1]!, "failed", "2026-11-04T11:00:00Z");
  await q(a.members[2]!, "complete", "2026-10-30T10:00:00Z"); // before the week
  await q(b.members[0]!, "failed", "2026-11-03T10:00:00Z");
  await q(b.members[0]!, "complete", "2026-11-03T11:00:00Z");
  await q(b.members[1]!, "failed", "2026-11-03T12:00:00Z");
  await q(b.members[1]!, "refused", "2026-11-03T12:30:00Z");
  await resolveWeeklyRaids(db!, new Date("2026-11-09T00:00:00Z"));
  const rows = await raidRows("2026-W45");
  assert.equal(rows.find((r) => r.clanId === a.id)!.metricValue, 66.67);
  assert.equal(rows.find((r) => r.clanId === b.id)!.metricValue, 25);
  assert.equal(await dispatchText(a.id), "RAID RESULT — WEEK 45. Your clan ranked 1 of 2. Quest completion: 66.7%. Rival clan: 25%. Gap: 41.7%.");
});

test("score raid sums members' hidden-score movement; only the clan sum is stored or shown", { skip }, async () => {
  const a = await mkClan("Alpha", 1);
  const b = await mkClan("Bravo", 2);
  await startWeeklyRaids(db!, new Date("2026-11-16T00:00:00Z")); // W47: 47 % 4 = 3, score
  assert.equal((await raidRows("2026-W47"))[0]!.type, "score");
  const snap = (userId: string, localDate: string, hidden: number) => db!.insert(dailySnapshots).values({ userId, localDate, scores: {}, hidden, rank: "E" });
  await snap(a.members[0]!, "2026-11-15", 40); // base: the last snapshot before the week
  await snap(a.members[0]!, "2026-11-22", 44);
  await snap(a.members[1]!, "2026-11-17", 30); // no earlier snapshot: the base is the first of the week
  await snap(a.members[1]!, "2026-11-21", 28);
  await snap(b.members[0]!, "2026-11-15", 50);
  await snap(b.members[0]!, "2026-11-20", 51);
  await resolveWeeklyRaids(db!, new Date("2026-11-23T00:00:00Z"));
  const rows = await raidRows("2026-W47");
  assert.equal(rows.find((r) => r.clanId === a.id)!.metricValue, 2); // +4 and -2
  assert.equal(rows.find((r) => r.clanId === b.id)!.metricValue, 1);
  assert.equal(await dispatchText(a.id), "RAID RESULT — WEEK 47. Your clan ranked 1 of 2. Score movement: +2. Rival clan: +1. Gap: 1.");
});

test("AI rewrite is used when sound; emoji falls back to the template", { skip }, async () => {
  const saved = env.GEMINI_API_KEY;
  env.GEMINI_API_KEY = "test-key";
  try {
    const { a, b } = await twoClans();
    await addLog(a.members[0]!, "2026-10-27T10:00:00Z");
    const g = (await raidRows())[0]!.groupId;
    const sound = "RAID RESULT, WEEK 44. Your clan ranked 1 of 2. Mind logs: 1. Rival clan: 0. Gap: 1. Logged.";
    let calls = 0;
    await resolveRaidGroup(db!, g, W44_CLOSE, {
      call: async () => {
        calls++;
        return calls === 1 ? sound : "RAID RESULT 44. Strong week \u{1F525}. 2 of 2.";
      },
    });
    assert.equal(calls, 2);
    // standings are written best first: clan A is asked first (the winner), clan B second
    assert.equal(await dispatchText(a.id), sound);
    assert.equal(await dispatchText(b.id), "RAID RESULT — WEEK 44. Your clan ranked 2 of 2. Mind logs: 0. Rival clan: 1. Gap: 1.");
  } finally {
    env.GEMINI_API_KEY = saved;
  }
});

test("a deleted clan leaves a raid group of one: closed without a result", { skip }, async () => {
  const { a, b } = await twoClans();
  await db!.delete(clans).where(eq(clans.id, b.id));
  assert.equal(await resolveWeeklyRaids(db!, W44_CLOSE), 1);
  const rows = await raidRows();
  assert.equal(rows.length, 1);
  assert.ok(rows[0]!.resolvedAt && !rows[0]!.winner);
  assert.equal((await clanRow(a.id)).raidWins, 0);
  assert.equal((await raidNotices(a.members[0]!)).length, 0);
});

test("runSocialJobs starts and resolves raids through the lock-guarded jobs", { skip }, async () => {
  await mkClan("Alpha", 1);
  await mkClan("Bravo", 2);
  const out = await runSocialJobs(db!, W44_MON);
  assert.equal(out.raidStart, 2);
  assert.equal(out.raidResolve, 0);
  assert.equal((await raidRows()).length, 2);
  assert.equal((await runSocialJobs(db!, W44_CLOSE)).raidResolve, 1);
});

// --- routes ------------------------------------------------------------------------------------

test("GET /api/clans/raid and /mine: live clan-level standings, no member data", { skip }, async () => {
  const clock = new Date("2026-10-28T12:00:00Z");
  const a = () => app({ now: () => clock });
  const { a: ca, b: cb } = await twoClans();
  const viewer = await setup(a(), { email: "viewer@example.com", username: "viewer_1" });
  await db!.insert(clanMembers).values({ userId: viewer.id, clanId: ca.id, role: "member", joinedAt: OLD_JOIN });
  await addLog(ca.members[0]!, "2026-10-27T10:00:00Z");
  await addLog(ca.members[1]!, "2026-10-28T10:00:00Z");
  await addLog(cb.members[0]!, "2026-10-27T10:00:00Z");
  await addLog(ca.members[0]!, "2026-10-29T10:00:00Z"); // after "now": not counted yet

  const res = await request(a()).get("/api/clans/raid").set(auth(viewer.token));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const raid = assertContract(RaidResponseSchema, res.body).raid!;
  assert.equal(raid.type, "domain");
  assert.equal(raid.weekKey, "2026-W44");
  assert.equal(raid.endsAt, "2026-11-01T23:59:00.000Z");
  assert.equal(raid.resolved, false);
  assert.deepEqual(raid.standings.map((s) => [s.name, s.metricValue, s.position, s.isMine]), [["Alpha", 2, 1, true], ["Bravo", 1, 2, false]]);
  assert.equal(raid.myPosition, 1);
  assert.equal(raid.myValue, 2);
  assert.doesNotMatch(JSON.stringify(res.body), /hidden|username|raider_|userId/i);

  const mine = assertContract(MyClanResponseSchema, (await request(a()).get("/api/clans/mine").set(auth(viewer.token))).body);
  assert.equal(mine.raid, null); // /mine carries no raid: the app reads GET /api/clans/raid

  const outsider = await setup(a(), { email: "out@example.com", username: "outsider_1" });
  assert.deepEqual((await request(a()).get("/api/clans/raid").set(auth(outsider.token))).body, { raid: null });
  assert.equal((await request(a()).get("/api/clans/raid")).status, 401);
});

test("after resolution the summary shows the settled result; a clan without a raid gets null", { skip }, async () => {
  const clock = new Date("2026-11-02T00:10:00Z");
  const a = () => app({ now: () => clock });
  const { a: ca } = await twoClans();
  const viewer = await setup(a(), { email: "viewer@example.com", username: "viewer_1" });
  await db!.insert(clanMembers).values({ userId: viewer.id, clanId: ca.id, role: "member", joinedAt: OLD_JOIN });
  await addLog(ca.members[0]!, "2026-10-27T10:00:00Z");
  await resolveWeeklyRaids(db!, W44_CLOSE);
  const raid = assertContract(RaidResponseSchema, (await request(a()).get("/api/clans/raid").set(auth(viewer.token))).body).raid!;
  assert.equal(raid.resolved, true);
  assert.equal(raid.myPosition, 1);
  await db!.delete(clanRaids);
  assert.deepEqual((await request(a()).get("/api/clans/raid").set(auth(viewer.token))).body, { raid: null });
});

test("live score-raid standings hide the values (positions only) until the raid resolves", { skip }, async () => {
  const clock = new Date("2026-11-18T12:00:00Z");
  const a = () => app({ now: () => clock });
  const ca = await mkClan("Alpha", 1);
  const cb = await mkClan("Bravo", 2);
  await startWeeklyRaids(db!, new Date("2026-11-16T00:00:00Z")); // W47: score
  const viewer = await setup(a(), { email: "viewer@example.com", username: "viewer_1" });
  await db!.insert(clanMembers).values({ userId: viewer.id, clanId: ca.id, role: "member", joinedAt: OLD_JOIN });
  const snap = (userId: string, localDate: string, hidden: number) => db!.insert(dailySnapshots).values({ userId, localDate, scores: {}, hidden, rank: "E" });
  await snap(ca.members[0]!, "2026-11-15", 40);
  await snap(ca.members[0]!, "2026-11-17", 47);
  await snap(cb.members[0]!, "2026-11-15", 50);
  await snap(cb.members[0]!, "2026-11-17", 51);
  const live = assertContract(RaidResponseSchema, (await request(a()).get("/api/clans/raid").set(auth(viewer.token))).body).raid!;
  assert.equal(live.type, "score");
  assert.equal(live.resolved, false);
  assert.deepEqual(live.standings.map((s) => [s.name, s.position, s.metricValue]), [["Alpha", 1, null], ["Bravo", 2, null]]);
  assert.equal(live.myPosition, 1);
  assert.equal(live.myValue, null);
  await resolveWeeklyRaids(db!, new Date("2026-11-23T00:00:00Z"));
  const done = assertContract(RaidResponseSchema, (await request(app({ now: () => new Date("2026-11-23T00:10:00Z") })).get("/api/clans/raid").set(auth(viewer.token))).body).raid!;
  assert.equal(done.resolved, true);
  assert.deepEqual(done.standings.map((s) => s.metricValue), [7, 1]);
});

test("a failing group is skipped and retried next tick; later groups still settle", { skip }, async () => {
  for (let i = 1; i <= 6; i++) await keepActive(await mkClan(`C${i}`, i, 3)); // groups of 4 and 2
  await startWeeklyRaids(db!, W44_MON);
  const groups = await db!.selectDistinct({ g: clanRaids.groupId }).from(clanRaids);
  const bad = groups[0]!.g;
  const flaky = async (d: typeof db, groupId: string, now: Date, ai?: unknown) => {
    if (groupId === bad) throw new Error("boom");
    return resolveRaidGroup(d!, groupId, now, ai as never);
  };
  assert.equal(await resolveWeeklyRaids(db!, W44_CLOSE, { resolve: flaky as never }), 1);
  assert.equal((await raidRows()).filter((r) => r.resolvedAt).length > 0, true);
  assert.equal((await raidRows()).filter((r) => r.groupId === bad && r.resolvedAt).length, 0);
  assert.equal((await db!.select().from(jobRuns).where(eq(jobRuns.job, "raid-resolve"))).length, 0); // not recorded: a group is left
  assert.equal(await resolveWeeklyRaids(db!, W44_CLOSE), 1); // next tick settles it
  assert.equal((await db!.select().from(jobRuns).where(eq(jobRuns.job, "raid-resolve")))[0]!.lastRunDate, "2026-10-26");
});

test("the bonus month is the raid week's, not the month of a late resolution", { skip }, async () => {
  const { a } = await twoClans();
  await addLog(a.members[0]!, "2026-10-27T10:00:00Z");
  await resolveWeeklyRaids(db!, new Date("2026-12-05T10:00:00Z")); // resolved late
  assert.equal((await clanRow(a.id)).raidBonusMonth, "2026-11");
});

test("a clan that dropped to forming mid-week still resolves with a position but cannot win the bonus", { skip }, async () => {
  const { a, b } = await twoClans();
  await addLog(a.members[0]!, "2026-10-27T10:00:00Z");
  await addLog(a.members[0]!, "2026-10-28T10:00:00Z");
  await db!.update(clans).set({ status: "forming", clanRank: null }).where(eq(clans.id, a.id));
  await resolveWeeklyRaids(db!, W44_CLOSE);
  const rows = await raidRows();
  const ra = rows.find((r) => r.clanId === a.id)!;
  assert.deepEqual([ra.position, ra.winner, !!ra.resolvedAt], [1, false, true]);
  assert.equal((await clanRow(a.id)).raidBonus, 0);
  assert.equal((await clanRow(a.id)).raidWins, 0);
  assert.equal((await clanRow(b.id)).raidBonus, 0);
  assert.equal((await raidNotices(a.members[0]!)).length, 1);
});
