// P5 final review fixes: rival de-anonymisation, handles after leaving/deletion, the named-challenge job, outcomes,
// blocks, PRO replays, raids, reports and the check-in cap.
import test, { after, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { and, eq, sql } from "drizzle-orm";
import { closeTestDb, resetDb } from "@workspace/db/testing";
import {
  clanMembers,
  clanRaids,
  clans,
  dailySnapshots,
  domainScores,
  duoMembers,
  duos,
  follows,
  logs,
  namedChallenges,
  notices,
  profiles,
  quests,
  rivalAssignments,
  rivalChallenges,
  scoreEvents,
  systemMessages,
  userDayState,
  userReports,
  users,
} from "@workspace/db";
import { FORMER_OPERATOR_HANDLE, MyClanResponseSchema, RaidResponseSchema, type MyClanResponse } from "@workspace/contracts";
import { addDays, endOfLocalDay } from "@workspace/engine";
import { app, assertContract, assertStoredNoticesMatchContract, auth, db, setup, skip, TZ } from "./game-test-helpers";
import { env } from "../lib/env";
import { grantEntitlement } from "../services/entitlements";
import { ensureRolledOver } from "../services/rollover";
import { insertNotice } from "../services/scoring";
import { resolveNamedChallenges } from "../services/challenges";
import { resolveWeeklyRaids, startWeeklyRaids } from "../jobs/social";
import { withUserLock } from "../services/user-lock";
import { signAccessToken } from "../lib/auth/tokens";

after(async () => {
  await closeTestDb();
});
afterEach(async () => {
  await assertStoredNoticesMatchContract();
});
beforeEach(async () => {
  if (db) await resetDb(db);
});

let clock = new Date();
const a = () => app({ now: () => clock });
const D0 = "2026-01-01";
const at = (date: string, hhmm = "12:00") => new Date(`${date}T${hhmm}:00+05:30`);
const after2h = (date: string) => new Date(endOfLocalDay(date, TZ).getTime() + 2 * 3600_000 + 60_000);
const PASSWORD = "correct horse battery";

type Identity = "anonymous" | "semi-public" | "public";
interface P {
  token: string;
  id: string;
  name: string;
  codename: string;
}
async function mk(name: string, identity: Identity = "anonymous"): Promise<P> {
  const { token, id } = await setup(a(), { email: `${name}@example.com`, username: name });
  if (identity !== "anonymous") {
    assert.equal((await request(a()).patch("/api/profile").set(auth(token)).send({ identitySetting: identity })).status, 200);
  }
  const [p] = await db!.select().from(profiles).where(eq(profiles.userId, id));
  return { token, id, name, codename: p!.publicCodename };
}
const makePro = async (p: P) => {
  await grantEntitlement(db!, p.id, "pro", null, new Date());
  await db!.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, p.id));
};
const pinToD0 = async (id: string) => {
  await db!.update(profiles).set({ onboardedAt: at(D0, "09:00"), rankSince: at(addDays(D0, -30)) }).where(eq(profiles.userId, id));
  await db!.update(dailySnapshots).set({ localDate: D0 }).where(eq(dailySnapshots.userId, id));
  await db!.update(userDayState).set({ nextRolloverAt: endOfLocalDay(D0, TZ) }).where(eq(userDayState.userId, id));
};
let logN = 0;
const addRecentLog = (id: string, when: Date) =>
  db!.insert(logs).values({ userId: id, clientId: `fl-${logN++}`, domain: "BODY", logType: "x", occurredAt: when, localDate: when.toISOString().slice(0, 10) });
const setRankAndScores = async (id: string, rank: string, value: number) => {
  await db!.update(profiles).set({ rank }).where(eq(profiles.userId, id));
  await db!.update(domainScores).set({ score: value }).where(eq(domainScores.userId, id));
};
const getRivals = async (p: P) => {
  const res = await request(a()).get("/api/rivals").set(auth(p.token));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body as { rivals: { assignmentId: string; isGhost: boolean; profile: { rank: string } }[] };
};
const realRivals = async (ownerId: string) =>
  (await db!.select().from(rivalAssignments).where(eq(rivalAssignments.userId, ownerId))).flatMap((r) => (r.rivalUserId ? [r.rivalUserId] : []));
const expireSlots = (ownerId: string) => db!.update(rivalAssignments).set({ expiresAt: new Date(clock.getTime() - 1000) }).where(eq(rivalAssignments.userId, ownerId));
let clanN = 0;
async function clanOf(...members: P[]) {
  const n = clanN++;
  const [c] = await db!
    .insert(clans)
    .values({ name: `Final ${n}`, nameLower: `final ${n}`, tag: "FIN", inviteCode: `FIN${String(n).padStart(5, "0")}` })
    .returning();
  for (const [i, m] of members.entries()) await db!.insert(clanMembers).values({ userId: m.id, clanId: c!.id, role: i === 0 ? "leader" : "member" });
  return c!.id;
}
async function duoOf(x: P, y: P) {
  const [d] = await db!.insert(duos).values({ userA: x.id, userB: y.id }).returning();
  for (const u of [x, y]) await db!.insert(duoMembers).values({ userId: u.id, duoId: d!.id });
}
const noticesOf = (id: string, kind: string) => db!.select().from(notices).where(and(eq(notices.userId, id), eq(notices.kind, kind)));
const mine = async (p: P): Promise<MyClanResponse> => {
  const res = await request(a()).get("/api/clans/mine").set(auth(p.token));
  assert.equal(res.status, 200);
  return assertContract(MyClanResponseSchema, res.body);
};
const deleteAccount = (p: P) => request(a()).delete("/api/auth/account").set(auth(p.token)).send({ password: PASSWORD });

// --- 1. rival de-anonymisation ------------------------------------------------------------------------

/** Two public D players 1 point apart, both active: each other's only real candidate. */
async function closePair() {
  clock = new Date();
  const x = await mk("xavi_1", "public");
  const y = await mk("yoko_1", "public");
  await setRankAndScores(x.id, "D", 33);
  await setRankAndScores(y.id, "D", 34);
  for (const u of [x, y]) await addRecentLog(u.id, clock);
  return { x, y };
}

test("rivals: a clanmate, a duo partner, a followee or a follower is never matched as a rival", { skip }, async () => {
  const { x, y } = await closePair();
  const tie = async (setUp: () => Promise<unknown>, tearDown: () => Promise<unknown>, label: string) => {
    await setUp();
    await expireSlots(x.id);
    await getRivals(x);
    assert.deepEqual(await realRivals(x.id), [], label);
    await tearDown();
  };
  await tie(() => clanOf(x, y), () => db!.delete(clans), "clanmate");
  await tie(() => duoOf(x, y), () => db!.delete(duos), "duo partner");
  await tie(() => db!.insert(follows).values({ followerId: x.id, followeeId: y.id }), () => db!.delete(follows), "followee");
  await tie(() => db!.insert(follows).values({ followerId: y.id, followeeId: x.id }), () => db!.delete(follows), "follower");
  // with no tie left, they match again
  await expireSlots(x.id);
  await getRivals(x);
  assert.deepEqual(await realRivals(x.id), [y.id]);
});

/** x and y hold each other as real rivals, and x has an open rival challenge on y's slot. */
async function matchedWithChallenge() {
  const { x, y } = await closePair();
  await getRivals(x);
  await getRivals(y);
  assert.deepEqual(await realRivals(x.id), [y.id]);
  assert.deepEqual(await realRivals(y.id), [x.id]);
  const [slot] = await db!.select().from(rivalAssignments).where(and(eq(rivalAssignments.userId, x.id), eq(rivalAssignments.rivalUserId, y.id)));
  const ch = await request(a()).post(`/api/rivals/${slot!.id}/challenge`).set(auth(x.token)).send({ domain: "MIND" });
  assert.equal(ch.status, 201, JSON.stringify(ch.body));
  return { x, y, challengeId: ch.body.id as string };
}
async function assertRematched(x: P, y: P, challengeId: string) {
  // Both sides are re-matched by the request itself (no read needed), and the open rival challenge is void.
  assert.deepEqual(await realRivals(x.id), []);
  assert.deepEqual(await realRivals(y.id), []);
  const [c] = await db!.select().from(rivalChallenges).where(eq(rivalChallenges.id, challengeId));
  assert.equal(c!.outcome, "void");
  assert.equal((await getRivals(x)).rivals.length, 3);
}

test("rivals: a follow re-matches both sides at once and voids the open rival challenge", { skip }, async () => {
  const { x, y, challengeId } = await matchedWithChallenge();
  assert.equal((await request(a()).post(`/api/social/follow/${x.name}`).set(auth(y.token))).status, 204);
  await assertRematched(x, y, challengeId);
});

test("rivals: a clan join re-matches a rival who becomes a clanmate", { skip }, async () => {
  const { x, y, challengeId } = await matchedWithChallenge();
  const clanId = await clanOf(x);
  assert.equal((await request(a()).post(`/api/clans/${clanId}/join`).set(auth(y.token)).send({})).status, 204);
  await assertRematched(x, y, challengeId);
});

test("rivals: a duo accept re-matches a rival who becomes the partner", { skip }, async () => {
  const { x, y, challengeId } = await matchedWithChallenge();
  const inv = await request(a()).post("/api/duo/invite").set(auth(x.token)).send({ username: y.name });
  assert.equal(inv.status, 201, JSON.stringify(inv.body));
  assert.equal((await request(a()).post(`/api/duo/invites/${inv.body.id}/accept`).set(auth(y.token)).send({})).status, 200);
  await assertRematched(x, y, challengeId);
});

test("rivals: a rank change through a real rollover transition re-matches every slot", { skip }, async () => {
  clock = at(D0);
  const u = await mk("rory_1");
  await pinToD0(u.id);
  const before = await getRivals(u);
  assert.ok(before.rivals.every((r) => r.profile.rank === "E"));
  await db!.update(domainScores).set({ score: 30 }).where(eq(domainScores.userId, u.id)); // hidden 30: tier D
  for (let i = 13; i >= 1; i--) {
    await db!.insert(dailySnapshots).values({ userId: u.id, localDate: addDays(D0, -i), scores: {}, hidden: 30, rank: "E" });
  }
  clock = at(addDays(D0, 1));
  await ensureRolledOver(db!, u.id, clock);
  assert.equal((await db!.select().from(profiles).where(eq(profiles.userId, u.id)))[0]!.rank, "D");
  const next = await getRivals(u);
  assert.equal(next.rivals.length, 3);
  for (const r of next.rivals) {
    assert.ok(!before.rivals.some((b) => b.assignmentId === r.assignmentId), "every slot was re-matched");
    assert.equal(r.profile.rank, "D");
  }
});

test("rivals: a ghost transmission replaced by the template is recorded with model template", { skip }, async () => {
  clock = new Date();
  const withAi = app({ now: () => clock, ai: { call: async () => "You stall. I do not." } });
  const u = await mk("tess_1");
  const body = await getRivals(u);
  const saved = env.GEMINI_API_KEY;
  env.GEMINI_API_KEY = "test-key";
  try {
    const res = await request(withAi).post(`/api/rivals/${body.rivals[0]!.assignmentId}/taunt`).set(auth(u.token)).send({});
    assert.equal(res.status, 201);
    assert.notEqual(res.body.message, "You stall. I do not.");
  } finally {
    env.GEMINI_API_KEY = saved;
  }
  const [m] = await db!.select().from(systemMessages).where(and(eq(systemMessages.userId, u.id), eq(systemMessages.messageType, "rival_taunt")));
  assert.equal(m!.model, "template");
});

// --- 2. handles after leaving and after deletion ---------------------------------------------------

test("clan dispatches render handles at read time: a former or deleted member reads FORMER OPERATOR", { skip }, async () => {
  clock = new Date();
  const lead = await mk("lead_1");
  await makePro(lead);
  const created = await request(a()).post("/api/clans").set(auth(lead.token)).send({ name: "Iron Wolves", tag: "IRON" });
  assert.equal(created.status, 201);
  const clanId = created.body.id as string;
  const u = await mk("gone_1");
  assert.equal((await request(a()).post(`/api/clans/${clanId}/join`).set(auth(u.token)).send({})).status, 204);
  // a current clanmate sees the username
  assert.ok((await mine(lead)).dispatches.some((d) => d.text === "OPERATOR gone_1 JOINED. Roster: 2."));
  assert.equal((await request(a()).post("/api/clans/leave").set(auth(u.token)).send({})).status, 204);

  const later = await mk("late_1");
  assert.equal((await request(a()).post(`/api/clans/${clanId}/join`).set(auth(later.token)).send({})).status, 204);
  for (const viewer of [later, lead]) {
    const texts = (await mine(viewer)).dispatches.map((d) => d.text);
    // left: neither the username nor the codename (old clanmates could link the two)
    assert.ok(!texts.some((t) => t.includes("gone_1") || t.includes(u.codename)), texts.join(" | "));
    assert.ok(texts.includes(`${FORMER_OPERATOR_HANDLE} JOINED. Roster: 2.`), texts.join(" | "));
    assert.ok(texts.includes(`${FORMER_OPERATOR_HANDLE} LEFT THE CLAN.`), texts.join(" | "));
    assert.ok(texts.includes("CLAN Iron Wolves [IRON] FOUNDED BY lead_1. Forming. 8 operators required."), texts.join(" | "));
  }

  // the former member's handle in other users' notices is scrubbed with the account
  const other = await mk("keep_1");
  await insertNotice(db!, later.id, "shame", { handle: u.name, questTitle: "Run" }, clock);
  await insertNotice(db!, later.id, "duo_checkin", { handle: u.name, kind: "going_now" }, clock);
  await insertNotice(db!, later.id, "challenge_received", { challengeId: "c1", handle: u.codename, domain: "MIND", days: 3 }, clock);
  await insertNotice(db!, later.id, "challenge_result", { challengeId: "c1", handle: u.codename, domain: "MIND", days: 3, outcome: "win", myGain: 1, theirGain: 0, delta: 3 }, clock);
  await insertNotice(db!, later.id, "shame", { handle: other.name, questTitle: "Read" }, clock);

  assert.equal((await deleteAccount(u)).status, 204);
  const texts = (await mine(later)).dispatches.map((d) => d.text);
  assert.ok(texts.includes(`${FORMER_OPERATOR_HANDLE} JOINED. Roster: 2.`), texts.join(" | "));
  assert.ok(texts.includes(`${FORMER_OPERATOR_HANDLE} LEFT THE CLAN.`), texts.join(" | "));
  assert.ok(!texts.some((t) => t.includes(u.codename) || t.includes("gone_1")));
  const handles = (await db!.select().from(notices).where(eq(notices.userId, later.id))).map((n) => (n.payload as { handle?: string }).handle);
  assert.deepEqual(handles.filter((h) => h === FORMER_OPERATOR_HANDLE).length, 4);
  assert.ok(handles.includes(other.name), "other users' handles are untouched");
  assert.ok(!JSON.stringify(handles).includes("gone_1") && !JSON.stringify(handles).includes(u.codename));
});

test("a deleted leader's FOUNDED BY line reads FORMER OPERATOR; the leadership line keeps the current leader", { skip }, async () => {
  clock = new Date();
  const lead = await mk("lead_1");
  await makePro(lead);
  const created = await request(a()).post("/api/clans").set(auth(lead.token)).send({ name: "Iron Wolves", tag: "IRON" });
  const clanId = created.body.id as string;
  const heir = await mk("heir_1");
  assert.equal((await request(a()).post(`/api/clans/${clanId}/join`).set(auth(heir.token)).send({})).status, 204);
  assert.equal((await request(a()).post("/api/clans/leader").set(auth(lead.token)).send({ userId: heir.id })).status, 204);
  assert.ok((await mine(heir)).dispatches.some((d) => d.text === "LEADERSHIP TRANSFERRED TO heir_1."));
  assert.equal((await deleteAccount(lead)).status, 204);
  const texts = (await mine(heir)).dispatches.map((d) => d.text);
  assert.ok(texts.includes(`CLAN Iron Wolves [IRON] FOUNDED BY ${FORMER_OPERATOR_HANDLE}. Forming. 8 operators required.`), texts.join(" | "));
  assert.ok(texts.includes("LEADERSHIP TRANSFERRED TO heir_1."));
});

// --- 3. named-challenge job -----------------------------------------------------------------------

async function activeChallenge(x: P, y: P, endDate: string) {
  const [c] = await db!
    .insert(namedChallenges)
    .values({ challengerId: x.id, opponentId: y.id, domain: "MIND", days: 3, status: "active", respondBy: new Date(), startDate: addDays(endDate, -2), endDate })
    .returning();
  return c!;
}

test("challenge job: only windows that ended before today (UTC) are attempted, and a pass stops at its time budget", { skip }, async () => {
  clock = new Date();
  const x = await mk("xena_1");
  const y = await mk("yuri_1");
  const z = await mk("zara_1");
  const now = new Date("2026-03-10T12:00:00Z");
  const today = await activeChallenge(x, y, "2026-03-10");
  const due1 = await activeChallenge(x, z, "2026-03-08");
  const due2 = await activeChallenge(y, z, "2026-03-09");
  const seen: string[] = [];
  const stub = async (_db: unknown, id: string) => (seen.push(id), "deferred" as const);
  let t = 0;
  await resolveNamedChallenges(db!, now, 100, { resolve: stub as never, budgetMs: 10, nowMs: () => (t += 20) });
  assert.equal(seen.length, 1, "the pass stopped after one challenge once its budget was spent");
  await resolveNamedChallenges(db!, now, 100, { resolve: stub as never });
  assert.ok(!seen.includes(today.id), "a window ending today (UTC) is not attempted");
  assert.deepEqual([...new Set(seen)].sort(), [due1.id, due2.id].sort());
  const [row] = await db!.select().from(namedChallenges).where(eq(namedChallenges.id, today.id));
  assert.equal(row!.lastAttemptAt, null);
});

// --- M1 / M5: outcome column, blocks ---------------------------------------------------------------

test("a resolved challenge keeps its outcome after the winner's account is deleted", { skip }, async () => {
  clock = at(D0);
  const x = await mk("xena_1");
  const y = await mk("yuri_1");
  for (const u of [x, y]) await pinToD0(u.id);
  const c = await activeChallenge(x, y, addDays(D0, 3));
  await db!.update(namedChallenges).set({ challengerStart: 10, opponentStart: 10 }).where(eq(namedChallenges.id, c.id));
  await db!.update(domainScores).set({ score: 30 }).where(and(eq(domainScores.userId, x.id), eq(domainScores.domain, "MIND")));
  await ensureRolledOver(db!, x.id, after2h(addDays(D0, 3)));
  await ensureRolledOver(db!, y.id, after2h(addDays(D0, 3)));
  const [done] = await db!.select().from(namedChallenges).where(eq(namedChallenges.id, c.id));
  assert.deepEqual([done!.status, done!.outcome], ["resolved", "challenger_won"]);
  await db!.delete(users).where(eq(users.id, x.id));
  clock = after2h(addDays(D0, 3));
  const list = await request(a()).get("/api/challenges").set(auth(y.token));
  assert.equal(list.status, 200);
  assert.equal(list.body.items[0].outcome, "loss");
});

test("a block voids the active named challenge between the pair with no score; a blocking clanmate gets no shame notice", { skip }, async () => {
  clock = at(D0);
  const x = await mk("xena_1", "public");
  const y = await mk("yuri_1", "public");
  for (const u of [x, y]) await pinToD0(u.id);
  const c = await activeChallenge(x, y, addDays(D0, 3));
  assert.equal((await request(a()).post(`/api/social/block/${x.name}`).set(auth(y.token))).status, 204);
  const [row] = await db!.select().from(namedChallenges).where(eq(namedChallenges.id, c.id));
  assert.deepEqual([row!.status, row!.outcome], ["void", "void"]);
  await ensureRolledOver(db!, x.id, after2h(addDays(D0, 3)));
  await ensureRolledOver(db!, y.id, after2h(addDays(D0, 3)));
  assert.equal((await db!.select().from(scoreEvents).where(eq(scoreEvents.reason, "challenge"))).length, 0);

  // shame: x's clanmates are y (blocked x) and m
  const m = await mk("mal_1");
  await clanOf(x, y, m);
  await db!.insert(quests).values({ userId: x.id, type: "daily", title: "Run 5k", description: "d", domain: "MIND", expiresAt: endOfLocalDay(addDays(D0, 4), TZ), shameMode: true });
  await ensureRolledOver(db!, x.id, after2h(addDays(D0, 4)));
  assert.equal((await noticesOf(m.id, "shame")).length, 1);
  assert.equal((await noticesOf(y.id, "shame")).length, 0);
});

// --- M6 / M7 ---------------------------------------------------------------------------------------

test("follow on a block answers 404 like an unknown player", { skip }, async () => {
  clock = new Date();
  const me = await mk("me_1", "public");
  const pub = await mk("pubby_1", "public");
  assert.equal((await request(a()).post(`/api/social/block/${pub.name}`).set(auth(me.token))).status, 204);
  for (const [from, to] of [[me, pub], [pub, me]] as const) {
    const r = await request(a()).post(`/api/social/follow/${to.name}`).set(auth(from.token));
    assert.equal(r.status, 404);
    assert.equal(r.body.code, "not_found");
  }
});

test("PRO routes replay a successful request after PRO lapses; a fresh request is 402", { skip }, async () => {
  clock = at(D0);
  const x = await mk("xena_1");
  const y = await mk("yuri_1", "public");
  await makePro(x);
  await db!.insert(follows).values({ followerId: x.id, followeeId: y.id });
  const send = (key: string) => request(a()).post("/api/challenges").set(auth(x.token)).set("Idempotency-Key", key).send({ opponent: y.name, domain: "MIND", days: 3 });
  const first = await send("ch-1");
  assert.equal(first.status, 201);
  const clan = await request(a()).post("/api/clans").set(auth(x.token)).set("Idempotency-Key", "cl-1").send({ name: "Iron Wolves", tag: "IRON" });
  assert.equal(clan.status, 201);
  const [q] = await db!.insert(quests).values({ userId: x.id, type: "daily", title: "Run", description: "d", domain: "MIND", expiresAt: endOfLocalDay(addDays(D0, 1), TZ) }).returning();
  const shame = (key: string) => request(a()).patch(`/api/quests/${q!.id}/shame`).set(auth(x.token)).set("Idempotency-Key", key).send({ enabled: true });
  assert.equal((await shame("sh-1")).status, 200);

  await grantEntitlement(db!, x.id, "free", null, new Date());
  const replay = await send("ch-1");
  assert.equal(replay.status, 200);
  assert.equal(replay.body.id, first.body.id);
  assert.equal((await request(a()).post("/api/clans").set(auth(x.token)).set("Idempotency-Key", "cl-1").send({ name: "Iron Wolves", tag: "IRON" })).status, 200);
  assert.equal((await shame("sh-1")).status, 200);
  for (const r of [await send("ch-2"), await shame("sh-2")]) {
    assert.equal(r.status, 402);
    assert.equal(r.body.code, "pro_required");
  }
});

// --- M2 / M3: score raids --------------------------------------------------------------------------

let rn = 0;
async function raidClan(name: string, rank: number, size: number) {
  const [c] = await db!
    .insert(clans)
    .values({ name, nameLower: name.toLowerCase(), tag: "RD", inviteCode: `R${String(rn++).padStart(7, "0")}`, status: "active", clanRank: rank, clanScore: 50, activeMemberCount: size })
    .returning();
  const members: string[] = [];
  for (let i = 0; i < size; i++) {
    const [u] = await db!
      .insert(users)
      .values({ email: `fr${rn}@x.com`, passwordHash: "h", username: `fraider_${rn++}`, birthYear: 1990, timezone: TZ, termsAcceptedAt: new Date() })
      .returning();
    await db!.insert(clanMembers).values({ userId: u!.id, clanId: c!.id, role: i === 0 ? "leader" : "member", joinedAt: new Date("2026-09-01T00:00:00Z") });
    members.push(u!.id);
  }
  return { id: c!.id, members };
}
const snap = (userId: string, localDate: string, hidden: number) => db!.insert(dailySnapshots).values({ userId, localDate, scores: {}, hidden, rank: "E" });

test("score raid: a snapshot dated the closing Monday is outside the week; a clan with fewer than 3 contributors shows no value", { skip }, async () => {
  const big = await raidClan("Alpha", 1, 3);
  const small = await raidClan("Bravo", 2, 3);
  await startWeeklyRaids(db!, new Date("2026-11-16T00:00:00Z")); // W47: score
  for (const m of big.members) {
    await snap(m, "2026-11-15", 40);
    await snap(m, "2026-11-22", 42); // +2 each: +6
    await snap(m, "2026-11-23", 90); // the closing Monday: not part of the week
  }
  await snap(small.members[0]!, "2026-11-15", 50);
  await snap(small.members[0]!, "2026-11-20", 51); // the only contributor
  await resolveWeeklyRaids(db!, new Date("2026-11-23T00:00:00Z"));
  const rows = await db!.select().from(clanRaids).where(eq(clanRaids.weekKey, "2026-W47"));
  assert.equal(rows.find((r) => r.clanId === big.id)!.metricValue, 6);

  const bigNotice = (await noticesOf(big.members[0]!, "raid_result"))[0]!.payload as { value: number | null; rivalValue: number | null; line: string };
  const smallNotice = (await noticesOf(small.members[0]!, "raid_result"))[0]!.payload as { value: number | null; rivalValue: number | null; line: string };
  assert.deepEqual([bigNotice.value, bigNotice.rivalValue], [6, null]);
  assert.deepEqual([smallNotice.value, smallNotice.rivalValue], [null, 6]);
  assert.ok(!/\b51\b|\+1\b/.test(smallNotice.line), smallNotice.line);
  assert.ok(smallNotice.line.includes("Score movement: withheld."), smallNotice.line);
  assert.ok(bigNotice.line.includes("Rival clan: withheld."), bigNotice.line);

  // the settled standings hide the suppressed value too
  const { token } = await signAccessToken({ id: small.members[0]!, role: "user", tokenVersion: 0 });
  const res = await request(app({ now: () => new Date("2026-11-24T10:00:00Z") })).get("/api/clans/raid").set(auth(token));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const raid = assertContract(RaidResponseSchema, res.body).raid!;
  assert.equal(raid.myValue, null);
  assert.equal(raid.standings.find((s) => s.isMine)!.metricValue, null);
  assert.equal(raid.standings.find((s) => !s.isMine)!.metricValue, 6);
});

// --- M8: account deletion ---------------------------------------------------------------------------

test("account deletion keeps reports about the user (subject snapshot) and waits for the user's lock", { skip }, async () => {
  clock = new Date();
  const reporter = await mk("rep_1");
  const subject = await mk("sub_1");
  const r = await request(a()).post("/api/social/report").set(auth(reporter.token)).send({ subject: subject.codename, reason: "spam" });
  assert.equal(r.status, 201);

  let release!: () => void;
  const gate = new Promise<void>((res) => (release = res));
  let locked!: () => void;
  const isLocked = new Promise<void>((res) => (locked = res));
  const holder = withUserLock(db!, subject.id, async () => {
    locked();
    await gate;
  });
  await isLocked;
  const del = deleteAccount(subject).then((res) => res);
  let waited = false;
  try {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const res = await db!.execute(sql`select count(*)::int as n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'`);
      if ((res.rows[0] as { n: number }).n >= 1) {
        waited = true;
        break;
      }
      await new Promise((res) => setTimeout(res, 20));
    }
  } finally {
    release();
    await holder;
  }
  assert.ok(waited, "the delete waited on the user lock");
  assert.equal((await del).status, 204);
  const [report] = await db!.select().from(userReports).where(eq(userReports.reporterId, reporter.id));
  assert.equal(report!.subjectId, null);
  assert.equal(report!.subjectHandle, "sub_1");
});

// --- M9: check-in cap under concurrency ---------------------------------------------------------------

test("concurrent check-ins never pass the daily cap", { skip }, async () => {
  clock = new Date();
  const x = await mk("xena_1", "public");
  const y = await mk("yuri_1", "public");
  await duoOf(x, y);
  const results = await Promise.all(
    Array.from({ length: 14 }, () => request(a()).post("/api/duo/checkin").set(auth(x.token)).send({ kind: "checked_in" })),
  );
  assert.equal(results.filter((r) => r.status === 201).length, 10);
  assert.equal(results.filter((r) => r.status === 429).length, 4);
});

test("challenge dispatches: a participant who later leaves reads FORMER OPERATOR; an outsider keeps the public projection", { skip }, async () => {
  clock = at(D0);
  const x = await mk("xena_1"); // anonymous: outside her clan only her codename is shown
  const y = await mk("yuri_1", "public");
  const mate = await mk("mate_1");
  for (const u of [x, y]) await makePro(u);
  const clanX = await clanOf(x, mate);
  await db!.insert(follows).values({ followerId: x.id, followeeId: y.id });
  const created = await request(a()).post("/api/challenges").set(auth(x.token)).send({ opponent: y.name, domain: "MIND", days: 3 });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal((await request(a()).post(`/api/challenges/${created.body.id}/accept`).set(auth(y.token)).send({})).status, 200);
  const line = async () => (await mine(mate)).dispatches.find((d) => d.kind === "challenge")!.text;
  assert.equal(await line(), "CHALLENGE — xena_1 vs yuri_1 — MIND, 3 days.");
  await db!.delete(clanMembers).where(eq(clanMembers.userId, x.id));
  assert.equal(await line(), `CHALLENGE — ${FORMER_OPERATOR_HANDLE} vs yuri_1 — MIND, 3 days.`);
  assert.ok(!(await line()).includes(x.codename));
  await db!.delete(users).where(eq(users.id, y.id));
  assert.equal(await line(), `CHALLENGE — ${FORMER_OPERATOR_HANDLE} vs ${FORMER_OPERATOR_HANDLE} — MIND, 3 days.`);
  void clanX;
});
