import test, { after, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { and, asc, eq, sql } from "drizzle-orm";
import { closeTestDb, resetDb } from "@workspace/db/testing";
import {
  blocks,
  dailySnapshots,
  domainScores,
  ghostRivals,
  logs,
  notices,
  profiles,
  rivalAssignments,
  rivalChallenges,
  rivalPressure,
  scoreEvents,
  systemMessages,
  userDayState,
} from "@workspace/db";
import { RANKED_DOMAINS, addDays, endOfLocalDay, ghostDrift, type RankedDomain } from "@workspace/engine";
import { RivalChallengeSchema, RivalTauntSchema, RivalsResponseSchema, type RivalsResponse } from "@workspace/contracts";
import { app, assertContract, assertStoredNoticesMatchContract, auth, db, setup, skip, TZ } from "./game-test-helpers";
import { env } from "../lib/env";
import { ensureRolledOver } from "../services/rollover";
import { buildUserContext } from "../services/ai-context";
import { RIVAL_JOB_LOCK, refreshExpiredRivals, runSocialJobs } from "../jobs/social";
import { ensureAssignments, usersWithExpiredSlots } from "../services/rivals";
import { tauntTemplate } from "./rivals";
import { withUserLock } from "../services/user-lock";

after(async () => {
  await closeTestDb();
});
afterEach(async () => {
  await assertStoredNoticesMatchContract();
});
beforeEach(async () => {
  if (db) await resetDb(db);
});

const D0 = "2026-01-01";
const at = (date: string, hhmm = "12:00") => new Date(`${date}T${hhmm}:00+05:30`);
/** The instant the passive rollover of `date` is due (2 h after the local day ends). */
const after2h = (date: string) => new Date(endOfLocalDay(date, TZ).getTime() + 2 * 3600_000 + 60_000);

let clock = new Date();
const a = () => app({ now: () => clock });

async function mk(name: string, identity: "anonymous" | "semi-public" | "public" = "anonymous") {
  const { token, id } = await setup(a(), { email: `${name}@example.com`, username: name });
  if (identity !== "anonymous") {
    assert.equal((await request(a()).patch("/api/profile").set(auth(token)).send({ identitySetting: identity })).status, 200);
  }
  const [p] = await db!.select().from(profiles).where(eq(profiles.userId, id));
  return { token, id, name, publicCodename: p!.publicCodename };
}

/** Pins a user's onboarding day to D0 (the rollover tests' calendar). */
async function pinToD0(id: string) {
  await db!.update(profiles).set({ onboardedAt: at(D0, "09:00"), rankSince: at(addDays(D0, -30)) }).where(eq(profiles.userId, id));
  await db!.update(dailySnapshots).set({ localDate: D0 }).where(eq(dailySnapshots.userId, id));
  await db!.update(userDayState).set({ nextRolloverAt: endOfLocalDay(D0, TZ) }).where(eq(userDayState.userId, id));
}

async function setRankAndScores(id: string, rank: string, value: number) {
  await db!.update(profiles).set({ rank }).where(eq(profiles.userId, id));
  await db!.update(domainScores).set({ score: value }).where(eq(domainScores.userId, id));
}

async function addRecentLog(id: string, when: Date) {
  await db!.insert(logs).values({
    userId: id,
    clientId: `log-${Math.random()}`,
    domain: "BODY",
    logType: "x",
    occurredAt: when,
    localDate: when.toISOString().slice(0, 10),
  });
}

async function getRivals(token: string): Promise<RivalsResponse> {
  const res = await request(a()).get("/api/rivals").set(auth(token));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return assertContract(RivalsResponseSchema, res.body);
}

/** No hidden-like or identifier key at any depth, and none of the forbidden strings anywhere in the payload. */
function deepScan(body: unknown, forbidden: string[]) {
  const walk = (v: unknown, path: string) => {
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
    else if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) {
        assert.ok(!/hidden/i.test(k), `hidden-like key at ${path}.${k}`);
        assert.ok(!/^(userId|email|rivalUserId|ghostId)$/.test(k), `identifier key at ${path}.${k}`);
        walk(x, `${path}.${k}`);
      }
    }
  };
  walk(body, "$");
  const text = JSON.stringify(body);
  for (const f of forbidden) assert.ok(!text.includes(f), `payload leaks ${f}`);
}

const ghostOf = async (assignmentId: string) => {
  const [asg] = await db!.select().from(rivalAssignments).where(eq(rivalAssignments.id, assignmentId));
  const [g] = await db!.select().from(ghostRivals).where(eq(ghostRivals.id, asg!.ghostId!));
  return g!;
};
const setGhostScores = async (ghostId: string, scores: Record<RankedDomain, number>, trajectory = "down") =>
  db!.update(ghostRivals).set({ scores, trajectory }).where(eq(ghostRivals.id, ghostId));
const flat = (v: number) => Object.fromEntries(RANKED_DOMAINS.map((d) => [d, v])) as Record<RankedDomain, number>;

// --- assignment -------------------------------------------------------------------------------

test("rank E user gets 3 ghosts", { skip }, async () => {
  clock = new Date();
  const u = await mk("eve_1");
  const body = await getRivals(u.token);
  assert.equal(body.rivals.length, 3);
  assert.deepEqual(body.rivals.map((r) => r.slot), [1, 2, 3]);
  for (const r of body.rivals) {
    assert.equal(r.isGhost, true);
    assert.match(r.codename, /^RIVAL \/\/ [A-Z]+-[1-9]$/);
    assert.equal(r.profile.handle, r.codename);
    assert.equal(r.profile.isCodename, true);
    assert.equal(r.profile.rank, "E");
    assert.deepEqual(Object.keys(r.profile.scores!).sort(), [...RANKED_DOMAINS].sort());
  }
  assert.equal(new Set(body.rivals.map((r) => r.codename)).size, 3);
  assert.deepEqual(body.record, { wins: 0, losses: 0, draws: 0 });
  // stable: a second read keeps the same slots
  const again = await getRivals(u.token);
  assert.deepEqual(again.rivals.map((r) => r.assignmentId), body.rivals.map((r) => r.assignmentId));
});

test("a lone user at rank B gets 3 ghost rivals at rank B (cold start)", { skip }, async () => {
  clock = new Date();
  const u = await mk("bea_1");
  await setRankAndScores(u.id, "B", 63);
  await addRecentLog(u.id, clock);
  const body = await getRivals(u.token);
  assert.equal(body.rivals.length, 3);
  for (const r of body.rivals) {
    assert.equal(r.isGhost, true);
    assert.equal(r.profile.rank, "B");
    for (const d of RANKED_DOMAINS) assert.ok(Math.abs(r.profile.scores![d] - 63) <= 6, `${d} ${r.profile.scores![d]}`);
  }
});

test("two D users within 5 points get matched to each other", { skip }, async () => {
  clock = new Date();
  const x = await mk("dee_1");
  const y = await mk("dee_2");
  const far = await mk("dee_far");
  const idle = await mk("dee_idle");
  await setRankAndScores(x.id, "D", 33);
  await setRankAndScores(y.id, "D", 36);
  await setRankAndScores(far.id, "D", 47); // 11+ from both: outside even the widened window
  await setRankAndScores(idle.id, "D", 34); // close, but no log in the last 7 days
  for (const u of [x, y, far]) await addRecentLog(u.id, clock);
  await addRecentLog(idle.id, new Date(clock.getTime() - 9 * 86_400_000));

  const bx = await getRivals(x.token);
  const real = bx.rivals.filter((r) => !r.isGhost);
  assert.equal(real.length, 1);
  assert.equal(bx.rivals.filter((r) => r.isGhost).length, 2);
  const [asg] = await db!.select().from(rivalAssignments).where(eq(rivalAssignments.id, real[0]!.assignmentId));
  assert.equal(asg!.rivalUserId, y.id);

  const by = await getRivals(y.token);
  const realY = by.rivals.filter((r) => !r.isGhost);
  assert.equal(realY.length, 1);
  const [asgY] = await db!.select().from(rivalAssignments).where(eq(rivalAssignments.id, realY[0]!.assignmentId));
  assert.equal(asgY!.rivalUserId, x.id);
});

test("widens to 10 points when nobody is within 5", { skip }, async () => {
  clock = new Date();
  const x = await mk("dee_1");
  const y = await mk("dee_2");
  await setRankAndScores(x.id, "D", 30);
  await setRankAndScores(y.id, "D", 38);
  for (const u of [x, y]) await addRecentLog(u.id, clock);
  const bx = await getRivals(x.token);
  assert.equal(bx.rivals.filter((r) => !r.isGhost).length, 1);
});

test("rank E users never get real rivals; blocked players are never matched", { skip }, async () => {
  clock = new Date();
  const e1 = await mk("eee_1");
  const e2 = await mk("eee_2");
  for (const u of [e1, e2]) await addRecentLog(u.id, clock);
  assert.ok((await getRivals(e1.token)).rivals.every((r) => r.isGhost));

  const x = await mk("dee_1");
  const y = await mk("dee_2");
  await setRankAndScores(x.id, "D", 33);
  await setRankAndScores(y.id, "D", 34);
  for (const u of [x, y]) await addRecentLog(u.id, clock);
  await db!.insert(blocks).values({ blockerId: y.id, blockedId: x.id });
  assert.ok((await getRivals(x.token)).rivals.every((r) => r.isGhost));
});

test("a block replaces a matched real rival at the next read", { skip }, async () => {
  clock = new Date();
  const x = await mk("dee_1");
  const y = await mk("dee_2", "public");
  await setRankAndScores(x.id, "D", 33);
  await setRankAndScores(y.id, "D", 34);
  for (const u of [x, y]) await addRecentLog(u.id, clock);
  assert.equal((await getRivals(x.token)).rivals.filter((r) => !r.isGhost).length, 1);
  assert.equal((await request(a()).post(`/api/social/block/${y.name}`).set(auth(x.token))).status, 204);
  assert.ok((await getRivals(x.token)).rivals.every((r) => r.isGhost));
});

test("rival payload for a semi-public real rival shows the assignment codename, not the username", { skip }, async () => {
  clock = new Date();
  const x = await mk("dee_1", "public");
  const y = await mk("secret_semi", "semi-public");
  await setRankAndScores(x.id, "D", 33);
  await setRankAndScores(y.id, "D", 35);
  for (const u of [x, y]) await addRecentLog(u.id, clock);
  const res = await request(a()).get("/api/rivals").set(auth(x.token));
  const body = assertContract(RivalsResponseSchema, res.body);
  const real = body.rivals.find((r) => !r.isGhost)!;
  assert.equal(real.profile.handle, real.codename);
  assert.equal(real.profile.isCodename, true);
  assert.match(real.codename, /^RIVAL \/\/ /);
  assert.deepEqual(real.profile.scores, flat(35));
  deepScan(res.body, ["secret_semi", y.publicCodename, y.id]);
});

test("expired slots and a rank change are re-matched; open challenges hold their slot", { skip }, async () => {
  clock = new Date();
  const u = await mk("eve_1");
  const first = await getRivals(u.token);
  // slot 1 has an open challenge: it is not replaced even when expired
  const declared = await request(a())
    .post(`/api/rivals/${first.rivals[0]!.assignmentId}/challenge`)
    .set(auth(u.token))
    .send({ domain: "MIND" });
  assert.equal(declared.status, 201);
  await db!.update(rivalAssignments).set({ expiresAt: new Date(clock.getTime() - 1000) }).where(eq(rivalAssignments.userId, u.id));
  await db!.update(profiles).set({ rank: "D" }).where(eq(profiles.userId, u.id));
  const next = await getRivals(u.token);
  assert.equal(next.rivals[0]!.assignmentId, first.rivals[0]!.assignmentId);
  assert.notEqual(next.rivals[1]!.assignmentId, first.rivals[1]!.assignmentId);
  assert.notEqual(next.rivals[2]!.assignmentId, first.rivals[2]!.assignmentId);
  assert.equal(next.rivals[1]!.profile.rank, "D");
  // the replaced ghosts are gone
  assert.equal((await db!.select().from(ghostRivals).where(eq(ghostRivals.ownerId, u.id))).length, 3);
});

// --- drift and pressure (rollover) -------------------------------------------------------------

test("ghost drift is deterministic per date and applied once per rollover date", { skip }, async () => {
  clock = at(D0);
  const u = await mk("eve_1");
  await pinToD0(u.id);
  const body = await getRivals(u.token);
  const before = await ghostOf(body.rivals[0]!.assignmentId);
  assert.equal(before.lastDriftDate, addDays(D0, -1));
  await ensureRolledOver(db!, u.id, after2h(D0));
  const drifted = await ghostOf(body.rivals[0]!.assignmentId);
  const expected = ghostDrift(
    { id: before.id, rank: before.rank as never, scores: before.scores as never, trajectory: before.trajectory as never, shadowActive: before.shadowActive },
    D0,
  );
  assert.deepEqual(drifted.scores, expected.scores);
  assert.equal(drifted.lastDriftDate, D0);
  // re-running the same rollover does not drift again
  await ensureRolledOver(db!, u.id, after2h(D0));
  assert.deepEqual((await ghostOf(body.rivals[0]!.assignmentId)).scores, expected.scores);
});

test("rival passing the user creates one rival_passed notice, not repeated next day", { skip }, async () => {
  clock = at(D0);
  const u = await mk("eve_1");
  await pinToD0(u.id);
  const body = await getRivals(u.token);
  const ghosts = await Promise.all(body.rivals.map((r) => ghostOf(r.assignmentId)));
  for (const g of ghosts) await setGhostScores(g.id, flat(1));
  await db!.update(rivalPressure).set({ ahead: false }).where(eq(rivalPressure.userId, u.id));
  const passed = async () =>
    db!.select().from(notices).where(and(eq(notices.userId, u.id), eq(notices.kind, "rival_passed"))).orderBy(asc(notices.createdAt));

  await ensureRolledOver(db!, u.id, after2h(D0));
  assert.equal((await passed()).length, 0);

  await setGhostScores(ghosts[0]!.id, { ...flat(1), MIND: 99 });
  await ensureRolledOver(db!, u.id, after2h(addDays(D0, 1)));
  const one = await passed();
  assert.equal(one.length, 1);
  assert.deepEqual(one[0]!.payload, { codename: body.rivals[0]!.codename, domain: "MIND", isGhost: true });

  // the morning briefing of that day carries one line about it
  const ctx = await buildUserContext(db!, u.id, after2h(addDays(D0, 1)));
  assert.deepEqual(ctx!.rivalPassed, [`${body.rivals[0]!.codename} passed your MIND score overnight.`]);

  await ensureRolledOver(db!, u.id, after2h(addDays(D0, 2)));
  assert.equal((await passed()).length, 1, "still ahead: no repeat");

  await setGhostScores(ghosts[0]!.id, flat(1));
  await ensureRolledOver(db!, u.id, after2h(addDays(D0, 3)));
  assert.equal((await passed()).length, 1, "fell behind: nothing");
  await setGhostScores(ghosts[0]!.id, { ...flat(1), MIND: 99 });
  await ensureRolledOver(db!, u.id, after2h(addDays(D0, 4)));
  assert.equal((await passed()).length, 2, "passed again after the order flipped");
  // two days later the briefing no longer mentions the first pass
  const later = await buildUserContext(db!, u.id, at(addDays(D0, 7)));
  assert.deepEqual(later!.rivalPassed, []);
});

// --- challenges ----------------------------------------------------------------------------------

test("rival challenge: one open per rival, resolves at the rollover after endDate with no score_events", { skip }, async () => {
  clock = at(D0);
  const u = await mk("eve_1");
  await pinToD0(u.id);
  const body = await getRivals(u.token);
  const rival = body.rivals[0]!;
  const g = await ghostOf(rival.assignmentId);
  await setGhostScores(g.id, flat(10), "down");

  const res = await request(a()).post(`/api/rivals/${rival.assignmentId}/challenge`).set(auth(u.token)).send({ domain: "MIND" });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const ch = assertContract(RivalChallengeSchema, res.body);
  assert.equal(ch.startDate, D0);
  assert.equal(ch.endDate, addDays(D0, 6));
  assert.equal(ch.outcome, null);
  assert.equal(ch.rivalStart, 10);
  assert.equal(ch.codename, rival.codename);

  const again = await request(a()).post(`/api/rivals/${rival.assignmentId}/challenge`).set(auth(u.token)).send({ domain: "BODY" });
  assert.equal(again.status, 409);
  assert.equal(again.body.code, "challenge_open");
  // another rival can be challenged at the same time
  const other = await request(a()).post(`/api/rivals/${body.rivals[1]!.assignmentId}/challenge`).set(auth(u.token)).send({ domain: "BODY" });
  assert.equal(other.status, 201);
  // unknown / foreign assignment and bad domain
  assert.equal((await request(a()).post(`/api/rivals/00000000-0000-4000-8000-000000000000/challenge`).set(auth(u.token)).send({ domain: "MIND" })).status, 404);
  assert.equal((await request(a()).post(`/api/rivals/${rival.assignmentId}/challenge`).set(auth(u.token)).send({ domain: "LUCK" })).status, 400);

  // the user gains MIND during the window
  await db!.update(domainScores).set({ score: ch.userStart + 5 }).where(and(eq(domainScores.userId, u.id), eq(domainScores.domain, "MIND")));
  await ensureRolledOver(db!, u.id, after2h(addDays(D0, 5)));
  let [row] = await db!.select().from(rivalChallenges).where(eq(rivalChallenges.id, ch.id));
  assert.equal(row!.outcome, null, "still open before endDate is rolled");

  const eventsBefore = (await db!.select({ id: scoreEvents.id }).from(scoreEvents).where(eq(scoreEvents.userId, u.id))).map((e) => e.id);
  await ensureRolledOver(db!, u.id, after2h(addDays(D0, 6)));
  [row] = await db!.select().from(rivalChallenges).where(eq(rivalChallenges.id, ch.id));
  assert.equal(row!.outcome, "win");
  assert.ok(row!.userEnd !== null && row!.rivalEnd !== null);
  const newEvents = (await db!.select().from(scoreEvents).where(eq(scoreEvents.userId, u.id))).filter((e) => !eventsBefore.includes(e.id));
  for (const e of newEvents) assert.ok(["decay", "streak_break", "quest_failed"].includes(e.reason), `unexpected score event ${e.reason}`);

  const results = await db!.select().from(notices).where(and(eq(notices.userId, u.id), eq(notices.kind, "rival_challenge_result")));
  assert.equal(results.length, 2);
  const mine = results.find((n) => (n.payload as { challengeId: string }).challengeId === ch.id)!;
  assert.equal((mine.payload as { outcome: string }).outcome, "win");

  clock = at(addDays(D0, 7));
  const after = await getRivals(u.token);
  assert.equal(after.record.wins + after.record.losses + after.record.draws, 2);
  assert.equal(after.record.wins, 1);
  const listed = after.challenges.find((c) => c.id === ch.id)!;
  assert.equal(listed.outcome, "win");
  assert.equal(listed.acknowledged, false);

  // ack: 204, marks the result notice seen; a second ack is idempotent
  assert.equal((await request(a()).post(`/api/rivals/challenges/${ch.id}/ack`).set(auth(u.token))).status, 204);
  assert.equal((await request(a()).post(`/api/rivals/challenges/${ch.id}/ack`).set(auth(u.token))).status, 204);
  const [seen] = await db!.select().from(notices).where(eq(notices.id, mine.id));
  assert.ok(seen!.seenAt);
  assert.equal((await getRivals(u.token)).challenges.find((c) => c.id === ch.id)!.acknowledged, true);

  // marking the other result notice seen acknowledges its challenge
  const otherNotice = results.find((n) => n.id !== mine.id)!;
  assert.equal((await request(a()).post("/api/notices/seen").set(auth(u.token)).send({ ids: [otherNotice.id] })).status, 204);
  const [otherRow] = await db!.select().from(rivalChallenges).where(eq(rivalChallenges.id, other.body.id));
  assert.ok(otherRow!.acknowledgedAt);
});

test("ack of an open challenge is 409, of an unknown one 404", { skip }, async () => {
  clock = new Date();
  const u = await mk("eve_1");
  const body = await getRivals(u.token);
  const res = await request(a()).post(`/api/rivals/${body.rivals[0]!.assignmentId}/challenge`).set(auth(u.token)).send({ domain: "MIND" });
  assert.equal((await request(a()).post(`/api/rivals/challenges/${res.body.id}/ack`).set(auth(u.token))).status, 409);
  assert.equal((await request(a()).post(`/api/rivals/challenges/00000000-0000-4000-8000-000000000000/ack`).set(auth(u.token))).status, 404);
  const other = await mk("eve_2");
  assert.equal((await request(a()).post(`/api/rivals/challenges/${res.body.id}/ack`).set(auth(other.token))).status, 404);
});

test("a challenge whose rival is gone resolves void, outside the record", { skip }, async () => {
  clock = at(D0);
  const x = await mk("dee_1");
  const y = await mk("dee_2");
  await pinToD0(x.id);
  await setRankAndScores(x.id, "D", 33);
  await setRankAndScores(y.id, "D", 34);
  for (const u of [x, y]) await addRecentLog(u.id, clock);
  const body = await getRivals(x.token);
  const real = body.rivals.find((r) => !r.isGhost)!;
  const res = await request(a()).post(`/api/rivals/${real.assignmentId}/challenge`).set(auth(x.token)).send({ domain: "BODY" });
  assert.equal(res.status, 201);
  await db!.execute(sql`delete from users where id = ${y.id}`);
  await ensureRolledOver(db!, x.id, after2h(addDays(D0, 6)));
  const [row] = await db!.select().from(rivalChallenges).where(eq(rivalChallenges.id, res.body.id));
  assert.equal(row!.outcome, "void");
  clock = at(addDays(D0, 7));
  assert.deepEqual((await getRivals(x.token)).record, { wins: 0, losses: 0, draws: 0 });
  assert.equal((await db!.select().from(notices).where(eq(notices.kind, "rival_challenge_result"))).length, 0);
});

// --- taunts ---------------------------------------------------------------------------------------

test("taunt: one per rival per local day, stored as a rival_taunt message; read marks", { skip }, async () => {
  clock = new Date();
  const u = await mk("eve_1");
  const body = await getRivals(u.token);
  const [r1, r2] = body.rivals;
  const res = await request(a()).post(`/api/rivals/${r1!.assignmentId}/taunt`).set(auth(u.token)).send({});
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const taunt = assertContract(RivalTauntSchema, res.body);
  assert.equal(taunt.codename, r1!.codename);
  assert.equal(taunt.read, false);
  assert.equal(taunt.isGhost, true);
  assert.ok(taunt.message.length > 0);
  assert.ok(!taunt.message.includes("!"));
  // a ghost is a simulation: its transmission never speaks as a person ("I", "me", "my", a signature)
  assert.ok(!/\b(I|me|my|mine|I'm)\b/.test(taunt.message), taunt.message);
  assert.ok(!taunt.message.includes("—"), taunt.message);
  const msgs = await db!.select().from(systemMessages).where(and(eq(systemMessages.userId, u.id), eq(systemMessages.messageType, "rival_taunt")));
  assert.equal(msgs.length, 1);

  const second = await request(a()).post(`/api/rivals/${r1!.assignmentId}/taunt`).set(auth(u.token)).send({});
  assert.equal(second.status, 429);
  assert.equal(second.body.code, "taunt_limit");
  assert.equal((await request(a()).post(`/api/rivals/${r2!.assignmentId}/taunt`).set(auth(u.token)).send({})).status, 201);
  assert.equal((await request(a()).post(`/api/rivals/00000000-0000-4000-8000-000000000000/taunt`).set(auth(u.token)).send({})).status, 404);

  // the next local day allows another
  clock = new Date(clock.getTime() + 86_400_000);
  assert.equal((await request(a()).post(`/api/rivals/${r1!.assignmentId}/taunt`).set(auth(u.token)).send({})).status, 201);

  const listed = await getRivals(u.token);
  assert.equal(listed.taunts.length, 3);
  assert.ok(listed.taunts.every((t) => !t.read));
  assert.equal((await request(a()).post("/api/rivals/taunts/read").set(auth(u.token)).send({})).status, 204);
  assert.ok((await getRivals(u.token)).taunts.every((t) => t.read));
});

test("taunt uses the model when available and its text when clean", { skip }, async () => {
  clock = new Date();
  const prompts: string[] = [];
  const withAi = app({ now: () => clock, ai: { call: async (_m, o) => (prompts.push(o.prompt), "RIVAL // ASH-1 does not stall. You do.") } });
  const u = await mk("eve_1");
  const body = await getRivals(u.token);
  const saved = env.GEMINI_API_KEY;
  env.GEMINI_API_KEY = "test-key";
  try {
    const res = await request(withAi).post(`/api/rivals/${body.rivals[0]!.assignmentId}/taunt`).set(auth(u.token)).send({});
    assert.equal(res.status, 201);
    assert.equal(res.body.message, "RIVAL // ASH-1 does not stall. You do.");
    assert.ok(prompts[0]!.includes(body.rivals[0]!.codename));
  } finally {
    env.GEMINI_API_KEY = saved;
  }
});

test("a first-person model transmission from a ghost falls back to the third-person template", { skip }, async () => {
  clock = new Date();
  const withAi = app({ now: () => clock, ai: { call: async () => "You stall. I do not." } });
  const u = await mk("eve_1");
  const body = await getRivals(u.token);
  const saved = env.GEMINI_API_KEY;
  env.GEMINI_API_KEY = "test-key";
  try {
    const res = await request(withAi).post(`/api/rivals/${body.rivals[0]!.assignmentId}/taunt`).set(auth(u.token)).send({});
    assert.equal(res.status, 201);
    assert.notEqual(res.body.message, "You stall. I do not.");
    assert.ok(res.body.message.includes(body.rivals[0]!.codename.split(" // ")[1]!), res.body.message);
    assert.equal(res.body.isGhost, true);
  } finally {
    env.GEMINI_API_KEY = saved;
  }
});

// --- job --------------------------------------------------------------------------------------------

test("the social job refreshes expired assignments, and skips while another instance holds its lock", { skip }, async () => {
  clock = new Date();
  const u = await mk("eve_1");
  const first = await getRivals(u.token);
  await db!
    .update(rivalAssignments)
    .set({ expiresAt: new Date(clock.getTime() - 1000) })
    .where(eq(rivalAssignments.id, first.rivals[1]!.assignmentId));

  // held elsewhere: skipped
  await db!.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${RIVAL_JOB_LOCK.namespace}, hashtext(${RIVAL_JOB_LOCK.key}))`);
    const r = await runSocialJobs(db!, clock);
    assert.equal(r.rivalRefresh, "skipped");
  });
  assert.ok(await db!.select().from(rivalAssignments).where(eq(rivalAssignments.id, first.rivals[1]!.assignmentId)).then((r) => r.length === 1));

  const r = await runSocialJobs(db!, clock);
  assert.equal(r.rivalRefresh, 1);
  const rows = await db!.select().from(rivalAssignments).where(eq(rivalAssignments.userId, u.id)).orderBy(asc(rivalAssignments.slot));
  assert.equal(rows.length, 3);
  assert.equal(rows[0]!.id, first.rivals[0]!.assignmentId);
  assert.notEqual(rows[1]!.id, first.rivals[1]!.assignmentId);
  assert.ok(rows[1]!.expiresAt.getTime() > clock.getTime());
});

test("job: users are refreshed in expires_at order, and the pass stops when its time budget is spent", { skip }, async () => {
  clock = new Date();
  const users3 = [await mk("job_1"), await mk("job_2"), await mk("job_3")];
  const firsts = [];
  for (const u of users3) firsts.push(await getRivals(u.token));
  // job_3 expired longest ago, then job_1, then job_2
  const expiredAgo = [2, 1, 3];
  for (let i = 0; i < 3; i++) {
    await db!
      .update(rivalAssignments)
      .set({ expiresAt: new Date(clock.getTime() - expiredAgo[i]! * 60_000) })
      .where(eq(rivalAssignments.id, firsts[i]!.rivals[0]!.assignmentId));
  }
  const order = await usersWithExpiredSlots(db!, clock, 10);
  assert.deepEqual(order, [users3[2]!.id, users3[0]!.id, users3[1]!.id]);

  // a budget of 0 ms is spent after the first user: one refresh, the rest wait for the next tick
  let t = 0;
  const done = await refreshExpiredRivals(db!, clock, 10, { budgetMs: 0, nowMs: () => t++ });
  assert.equal(done, 1);
  const left = await usersWithExpiredSlots(db!, clock, 10);
  assert.deepEqual(left, [users3[0]!.id, users3[1]!.id]);
  // within a generous budget everything else is picked up
  assert.equal(await refreshExpiredRivals(db!, clock, 10, { budgetMs: 60_000 }), 2);
});

// --- carried fixes ------------------------------------------------------------------------------------

test("matching picks the closest candidates by snapshot hidden score, not by user id order", { skip }, async () => {
  clock = new Date();
  const me = await mk("cap_me");
  await setRankAndScores(me.id, "D", 33);
  await addRecentLog(me.id, clock);
  const cands = [];
  for (let i = 0; i < 4; i++) cands.push(await mk(`cap_${i}`));
  // far candidates get the LOWEST ids, the close ones the highest: an id-ordered cut-off would keep the far ones
  cands.sort((x, y) => (x.id < y.id ? -1 : 1));
  const values = [48, 49, 34, 35];
  for (let i = 0; i < 4; i++) {
    await setRankAndScores(cands[i]!.id, "D", values[i]!);
    await addRecentLog(cands[i]!.id, clock);
    await db!.update(dailySnapshots).set({ hidden: values[i]! }).where(eq(dailySnapshots.userId, cands[i]!.id));
  }
  await db!.update(dailySnapshots).set({ hidden: 33 }).where(eq(dailySnapshots.userId, me.id));
  await withUserLock(db!, me.id, (tx) => ensureAssignments(tx, me.id, clock, { candidateLimit: 2 }));
  const rows = await db!.select().from(rivalAssignments).where(eq(rivalAssignments.userId, me.id));
  const matched = rows.flatMap((r) => (r.rivalUserId ? [r.rivalUserId] : [])).sort();
  assert.deepEqual(matched, [cands[2]!.id, cands[3]!.id].sort());
});

test("ghost transmission templates are third person and never claim to be a person", () => {
  for (let day = 0; day < 10; day++) {
    for (const trajectory of ["up", "stable", "down"]) {
      const g = tauntTemplate("RIVAL // ASH-2", trajectory, day, true);
      assert.ok(g.includes("ASH-2"), g);
      assert.ok(!/\b(I|me|my|mine|I'm)\b/.test(g), g);
      assert.ok(!g.includes("—"), g);
    }
  }
  assert.ok(tauntTemplate("RIVAL // ASH-2", "up", 0, false).includes("— ASH-2"));
});
