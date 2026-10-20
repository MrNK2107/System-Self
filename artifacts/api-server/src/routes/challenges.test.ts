import test, { after, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { closeTestDb, resetDb } from "@workspace/db/testing";
import {
  achievements,
  blocks,
  clanMembers,
  clans,
  dailySnapshots,
  domainScores,
  follows,
  namedChallenges,
  notices,
  profiles,
  quests,
  scoreEvents,
  userDayState,
  users,
} from "@workspace/db";
import { addDays, endOfLocalDay } from "@workspace/engine";
import { ChallengeListResponseSchema, ChallengeSchema, QuestSchema } from "@workspace/contracts";
import { app, assertContract, assertStoredNoticesMatchContract, auth, db, setup, skip, TZ } from "./game-test-helpers";
import { clanDispatches } from "@workspace/db";
import { grantEntitlement } from "../services/entitlements";
import { ensureRolledOver } from "../services/rollover";
import { lockOrder, resolveChallengeById, resolveNamedChallenges } from "../services/challenges";
import { runSocialJobs } from "../jobs/social";
import { recentDispatches } from "../services/clans";
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

interface P {
  token: string;
  id: string;
  name: string;
  codename: string;
}
async function mk(name: string, opts: { pro?: boolean; identity?: "anonymous" | "semi-public" | "public" } = {}): Promise<P> {
  const { token, id } = await setup(a(), { email: `${name}@example.com`, username: name });
  if (opts.identity && opts.identity !== "anonymous") {
    assert.equal((await request(a()).patch("/api/profile").set(auth(token)).send({ identitySetting: opts.identity })).status, 200);
  }
  if (opts.pro !== false) await grantEntitlement(db!, id, "pro", null, new Date());
  await db!.update(profiles).set({ onboardedAt: at(D0, "09:00"), rankSince: at(addDays(D0, -30)) }).where(eq(profiles.userId, id));
  await db!.update(dailySnapshots).set({ localDate: D0 }).where(eq(dailySnapshots.userId, id));
  await db!.update(userDayState).set({ nextRolloverAt: endOfLocalDay(D0, TZ) }).where(eq(userDayState.userId, id));
  const [p] = await db!.select().from(profiles).where(eq(profiles.userId, id));
  return { token, id, name, codename: p!.publicCodename };
}

const follow = (follower: P, followee: P) => db!.insert(follows).values({ followerId: follower.id, followeeId: followee.id });
let clanN = 0;
async function clanOf(...members: P[]) {
  const n = clanN++;
  const [c] = await db!
    .insert(clans)
    .values({ name: `Clan ${n}`, nameLower: `clan ${n}`, tag: "TST", inviteCode: `INV${String(n).padStart(5, "0")}` })
    .returning();
  for (const [i, m] of members.entries()) await db!.insert(clanMembers).values({ userId: m.id, clanId: c!.id, role: i === 0 ? "leader" : "member" });
  return c!.id;
}
const setScore = (id: string, domain: string, score: number) =>
  db!.update(domainScores).set({ score }).where(and(eq(domainScores.userId, id), eq(domainScores.domain, domain)));
const scoreOf = async (id: string, domain: string) =>
  (await db!.select().from(domainScores).where(and(eq(domainScores.userId, id), eq(domainScores.domain, domain))))[0]!.score;
const bump = async (id: string, domain: string, by: number) => setScore(id, domain, (await scoreOf(id, domain)) + by);
const challengeEvents = (id: string) =>
  db!.select().from(scoreEvents).where(and(eq(scoreEvents.userId, id), eq(scoreEvents.reason, "challenge")));
const create = (from: P, opponent: string, body: Record<string, unknown> = {}) =>
  request(a()).post("/api/challenges").set(auth(from.token)).send({ opponent, domain: "MIND", days: 3, ...body });
const respond = (who: P, id: string, verb: "accept" | "ignore") => request(a()).post(`/api/challenges/${id}/${verb}`).set(auth(who.token));
async function list(who: P) {
  const res = await request(a()).get("/api/challenges").set(auth(who.token));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return assertContract(ChallengeListResponseSchema, res.body).items;
}
const noticesOf = (id: string, kind: string) => db!.select().from(notices).where(and(eq(notices.userId, id), eq(notices.kind, kind)));
const payloadOf = (n: { payload: unknown }) => n.payload as Record<string, unknown>;
const challengeAchievements = async (id: string) =>
  (await db!.select().from(achievements).where(eq(achievements.userId, id)))
    .map((r) => r.achievementId)
    .filter((a) => a.startsWith("challenge_"))
    .sort();
const row = async (id: string) => (await db!.select().from(namedChallenges).where(eq(namedChallenges.id, id)))[0]!;

/** x follows y (a public player, so the username resolves). */
async function pair() {
  const x = await mk("xena_1");
  const y = await mk("yuri_1", { identity: "public" });
  await follow(x, y);
  return { x, y };
}
/** Creates and accepts a 3-day MIND challenge x -> y on D0 (the window opens the next day: D0+1..D0+3). */
async function active(x: P, y: P) {
  clock = at(D0);
  const res = await create(x, y.name);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const acc = await respond(y, res.body.id, "accept");
  assert.equal(acc.status, 200, JSON.stringify(acc.body));
  return res.body.id as string;
}
const rollTo = (p: P, date: string) => ensureRolledOver(db!, p.id, after2h(date));
const START = addDays(D0, 1);
const END = addDays(D0, 3);

// --- creation and eligibility -------------------------------------------------------------------

test("challenge a stranger -> 403; non-PRO -> 402; self, unknown handle, blocked, bad input", { skip }, async () => {
  clock = at(D0);
  const x = await mk("xena_1");
  const stranger = await mk("sam_1", { identity: "public" });
  const free = await mk("fred_1", { pro: false });
  const r1 = await create(x, stranger.name);
  assert.equal(r1.status, 403);
  assert.equal(r1.body.code, "not_eligible");
  // a codename resolves for everyone, but a stranger is still not eligible
  assert.equal((await create(x, stranger.codename)).status, 403);
  assert.equal((await create(free, stranger.name)).status, 402);
  assert.equal((await create(x, x.name)).status, 400);
  assert.equal((await create(x, "nobody_here")).status, 404);
  await follow(x, stranger);
  assert.equal((await create(x, stranger.name, { days: 5 })).status, 400);
  assert.equal((await create(x, stranger.name, { domain: "LUCK" })).status, 400);
  await db!.insert(blocks).values({ blockerId: stranger.id, blockedId: x.id });
  assert.equal((await create(x, stranger.name)).status, 403);
  assert.equal((await db!.select().from(namedChallenges)).length, 0);
});

test("a followed user and a clanmate can be challenged; the opponent is told with a challenge_received notice", { skip }, async () => {
  clock = at(D0);
  const x = await mk("xena_1");
  const y = await mk("yuri_1", { identity: "public" });
  const z = await mk("zed_1"); // anonymous clanmate: inside the clan usernames are shown
  await follow(x, y);
  await clanOf(x, z);
  const r1 = await create(x, y.name);
  assert.equal(r1.status, 201, JSON.stringify(r1.body));
  const ch = assertContract(ChallengeSchema, r1.body);
  assert.equal(ch.role, "challenger");
  assert.equal(ch.status, "pending");
  assert.equal(ch.opponent.handle, y.name);
  assert.equal(ch.days, 3);
  assert.equal(ch.myGain, null);
  const r2 = await create(x, z.name, { domain: "BODY", days: 30 });
  assert.equal(r2.status, 201, JSON.stringify(r2.body));
  assert.equal(r2.body.opponent.handle, "zed_1");

  // x is anonymous and y does not share a clan with x: y sees x's public codename only
  const got = await noticesOf(y.id, "challenge_received");
  assert.equal(got.length, 1);
  assert.deepEqual(got[0]!.payload, { challengeId: ch.id, handle: x.codename, domain: "MIND", days: 3 });
  // the clanmate sees the challenger's username
  assert.equal(payloadOf((await noticesOf(z.id, "challenge_received"))[0]!).handle, "xena_1");

  const mineY = await list(y);
  assert.equal(mineY.length, 1);
  assert.equal(mineY[0]!.role, "opponent");
  assert.equal(mineY[0]!.status, "pending");
  assert.equal(mineY[0]!.opponent.handle, x.codename);
  assert.equal(mineY[0]!.opponent.isCodename, true);
});

test("at most 3 open challenges per user, both roles count; one open challenge per pair", { skip }, async () => {
  clock = at(D0);
  const x = await mk("xena_1");
  const o = [
    await mk("o1_1", { identity: "public" }),
    await mk("o2_1", { identity: "public" }),
    await mk("o3_1", { identity: "public" }),
    await mk("o4_1", { identity: "public" }),
  ];
  for (const p of o) await follow(x, p);
  assert.equal((await create(x, "o1_1")).status, 201);
  const dup = await create(x, "o1_1", { domain: "BODY" });
  assert.equal(dup.status, 409);
  assert.equal(dup.body.code, "challenge_open");
  assert.equal((await create(x, "o2_1")).status, 201);
  assert.equal((await create(x, "o3_1")).status, 201);
  const over = await create(x, "o4_1");
  assert.equal(over.status, 409);
  assert.equal(over.body.code, "challenge_limit");

  // the opponent's side counts too: o4 receives three, the fourth challenger is refused
  const y = o[3]!;
  const fans = [await mk("f1_1"), await mk("f2_1"), await mk("f3_1"), await mk("f4_1")];
  for (const f of fans) await follow(f, y);
  for (const f of fans.slice(0, 3)) assert.equal((await create(f, y.name)).status, 201);
  const busy = await create(fans[3]!, y.name);
  assert.equal(busy.status, 409);
  assert.equal(busy.body.code, "opponent_busy");

  // an ignored challenge frees the slot
  const first = (await list(x)).find((c) => c.opponent.handle === "o1_1")!;
  assert.equal((await respond(o[0]!, first.id, "ignore")).status, 200);
  assert.equal((await create(x, "o1_1", { domain: "BODY" })).status, 201);
});

// --- accept / ignore ------------------------------------------------------------------------------

test("ignore -> the challenger sees status ignored with 'Challenge ignored. Logged.'", { skip }, async () => {
  const { x, y } = await pair();
  clock = at(D0);
  const res = await create(x, y.name);
  assert.equal((await respond(x, res.body.id, "ignore")).status, 404); // only the opponent answers
  assert.equal((await respond(x, res.body.id, "accept")).status, 404);
  const ig = await respond(y, res.body.id, "ignore");
  assert.equal(ig.status, 200);
  assert.equal(assertContract(ChallengeSchema, ig.body).status, "ignored");
  const seen = (await list(x))[0]!;
  assert.equal(seen.status, "ignored");
  assert.equal(seen.line, "Challenge ignored. Logged.");
  assert.equal((await list(y))[0]!.line, null);
  assert.equal((await respond(y, res.body.id, "accept")).status, 409);
  assert.equal((await respond(y, res.body.id, "ignore")).status, 409);
});

test("a challenge not answered within 48 h is ignored automatically", { skip }, async () => {
  const { x, y } = await pair();
  clock = at(D0);
  const res = await create(x, y.name);
  clock = new Date(at(D0).getTime() + 47 * 3600_000);
  assert.equal((await list(x))[0]!.status, "pending");
  clock = new Date(at(D0).getTime() + 48 * 3600_000 + 1000);
  const late = await respond(y, res.body.id, "accept");
  assert.equal(late.status, 409);
  assert.equal(late.body.code, "expired");
  const seen = (await list(x))[0]!;
  assert.equal(seen.status, "ignored");
  assert.equal(seen.line, "Challenge ignored. Logged.");
  // the job sweeps pending ones nobody opened
  clock = at(addDays(D0, 5));
  const r2 = await create(x, y.name);
  clock = new Date(at(addDays(D0, 5)).getTime() + 49 * 3600_000);
  await resolveNamedChallenges(db!, clock);
  assert.equal((await row(r2.body.id)).status, "ignored");
});

test("accept captures start values and the window; the live comparison carries domain gains only", { skip }, async () => {
  const { x, y } = await pair();
  await setScore(x.id, "MIND", 40);
  await setScore(y.id, "MIND", 55);
  // Starts are each player's own snapshot of the accept day (the day before the window opens).
  for (const [u, v] of [[x, 40], [y, 55]] as const) {
    const [snap] = await db!.select().from(dailySnapshots).where(eq(dailySnapshots.userId, u.id));
    await db!.update(dailySnapshots).set({ scores: { ...(snap!.scores as object), MIND: v } }).where(eq(dailySnapshots.userId, u.id));
  }
  const id = await active(x, y);
  const r = await row(id);
  assert.equal(r.status, "active");
  assert.equal(r.startDate, START, "the window opens the local day after acceptance");
  assert.equal(r.endDate, END, "endDate = startDate + days - 1");
  assert.deepEqual([r.challengerStart, r.opponentStart], [40, 55]);
  await setScore(x.id, "MIND", 44);
  await setScore(y.id, "MIND", 56);
  const mine = (await list(x))[0]!;
  assert.deepEqual([mine.status, mine.myGain, mine.theirGain, mine.startDate, mine.endDate], ["active", 4, 1, START, END]);
  const theirs = (await list(y))[0]!;
  assert.deepEqual([theirs.myGain, theirs.theirGain], [1, 4]);
  assert.ok(!/hidden|userId/i.test(JSON.stringify([mine, theirs])));
});

// --- resolution -------------------------------------------------------------------------------------

test("resolution: winner +3.0, loser -1.5 DISCIPLINE with score_events reason challenge; once; both notified", { skip }, async () => {
  const { x, y } = await pair();
  const id = await active(x, y);
  await bump(x.id, "MIND", 6);
  await bump(y.id, "MIND", 2);
  await rollTo(x, END);
  assert.equal((await row(id)).status, "active", "waits until the opponent has rolled the end date too");
  await rollTo(y, END);
  const r = await row(id);
  assert.equal(r.status, "resolved");
  assert.equal(r.winnerId, x.id);
  assert.ok(r.challengerEnd !== null && r.opponentEnd !== null && r.resolvedAt);

  assert.deepEqual((await challengeEvents(x.id)).map((e) => [e.domain, e.delta, e.refId]), [["DISCIPLINE", 3, id]]);
  assert.deepEqual((await challengeEvents(y.id)).map((e) => [e.domain, e.delta, e.refId]), [["DISCIPLINE", -1.5, id]]);

  const nx = await noticesOf(x.id, "challenge_result");
  const ny = await noticesOf(y.id, "challenge_result");
  assert.equal(nx.length, 1);
  assert.equal(ny.length, 1);
  assert.deepEqual([payloadOf(nx[0]!).outcome, payloadOf(nx[0]!).delta, payloadOf(nx[0]!).handle], ["win", 3, "yuri_1"]);
  assert.deepEqual([payloadOf(ny[0]!).outcome, payloadOf(ny[0]!).delta, payloadOf(ny[0]!).handle], ["loss", -1.5, x.codename]);

  // exactly once: later rollovers and the job change nothing
  await rollTo(x, addDays(END, 1));
  await rollTo(y, addDays(END, 1));
  await resolveNamedChallenges(db!, after2h(addDays(END, 2)));
  assert.equal((await challengeEvents(x.id)).length, 1);
  assert.equal((await challengeEvents(y.id)).length, 1);
  assert.equal((await noticesOf(x.id, "challenge_result")).length, 1);
  const done = (await list(y))[0]!;
  // Both decayed alike over the window, so the gap between the gains is exactly the 4 points x gained on y.
  assert.deepEqual([done.status, done.outcome], ["resolved", "loss"]);
  assert.equal(Math.round((done.theirGain! - done.myGain!) * 100) / 100, 4);
});

test("draw -> resolved with no score events", { skip }, async () => {
  const { x, y } = await pair();
  const id = await active(x, y);
  await rollTo(x, END);
  await rollTo(y, END);
  const r = await row(id);
  assert.equal(r.status, "resolved");
  assert.equal(r.winnerId, null);
  assert.equal((await challengeEvents(x.id)).length + (await challengeEvents(y.id)).length, 0);
  const n = await noticesOf(x.id, "challenge_result");
  assert.deepEqual([payloadOf(n[0]!).outcome, payloadOf(n[0]!).delta], ["draw", 0]);
});

test("a win unlocks challenge_win for the winner only", { skip }, async () => {
  const { x, y } = await pair();
  const id = await active(x, y);
  await bump(x.id, "MIND", 6);
  await rollTo(x, END);
  await rollTo(y, END);
  assert.equal((await row(id)).winnerId, x.id);
  assert.deepEqual(await challengeAchievements(x.id), ["challenge_win"]);
  assert.deepEqual(await challengeAchievements(y.id), []);
});

/** Seeds settled challenges between x and y: `wins` won by x, plus one each lost, drawn and voided. */
async function pastChallenges(x: P, y: P, wins: number) {
  const past = { challengerId: x.id, opponentId: y.id, domain: "MIND", days: 3, status: "resolved", respondBy: at(D0), resolvedAt: at(D0) };
  for (let i = 0; i < wins; i++) await db!.insert(namedChallenges).values({ ...past, winnerId: x.id, outcome: "challenger_won" });
  await db!.insert(namedChallenges).values({ ...past, winnerId: y.id, outcome: "opponent_won" });
  await db!.insert(namedChallenges).values({ ...past, winnerId: null, outcome: "draw" });
  await db!.insert(namedChallenges).values({ ...past, status: "void", winnerId: null, outcome: "void" });
}
async function liveWin(x: P, y: P) {
  const id = await active(x, y);
  await bump(x.id, "MIND", 6);
  await rollTo(x, END);
  await rollTo(y, END);
  assert.equal((await row(id)).winnerId, x.id);
}

test("losses, draws and voids are not wins: 3 past wins + this one = 4 -> no challenge_5", { skip }, async () => {
  const { x, y } = await pair();
  await pastChallenges(x, y, 3);
  await liveWin(x, y);
  assert.deepEqual(await challengeAchievements(x.id), ["challenge_win"]);
});

test("the fifth win unlocks challenge_5", { skip }, async () => {
  const { x, y } = await pair();
  await pastChallenges(x, y, 4);
  await liveWin(x, y);
  assert.deepEqual(await challengeAchievements(x.id), ["challenge_5", "challenge_win"]);
});

test("deleted opponent -> void, no events, no result notice", { skip }, async () => {
  const { x, y } = await pair();
  const id = await active(x, y);
  await bump(x.id, "MIND", 6);
  await db!.delete(users).where(eq(users.id, y.id));
  const gone = await row(id);
  assert.equal(gone.opponentId, null);
  assert.equal(gone.status, "active");
  await rollTo(x, END);
  const r = await row(id);
  assert.equal(r.status, "void");
  assert.equal(r.winnerId, null);
  assert.equal((await challengeEvents(x.id)).length, 0);
  assert.equal((await noticesOf(x.id, "challenge_result")).length, 0);
  const v = (await list(x))[0]!;
  assert.deepEqual([v.status, v.opponent.handle, v.outcome], ["void", null, null]);
});

test("a pending challenge to a deleted account is voided by the job", { skip }, async () => {
  const { x, y } = await pair();
  clock = at(D0);
  const res = await create(x, y.name);
  await db!.delete(users).where(eq(users.id, y.id));
  await resolveNamedChallenges(db!, clock);
  assert.equal((await row(res.body.id)).status, "void");
});

test("concurrent double resolution applies the result exactly once", { skip }, async () => {
  const { x, y } = await pair();
  const id = await active(x, y);
  await bump(x.id, "MIND", 6);
  // Both users are rolled through the end date but nothing resolved the challenge yet.
  await db!.update(userDayState).set({ lastRolledDate: END }).where(eq(userDayState.userId, x.id));
  await db!.update(userDayState).set({ lastRolledDate: END }).where(eq(userDayState.userId, y.id));
  const now = after2h(END);
  const results = await Promise.all([1, 2, 3, 4].map(() => resolveChallengeById(db!, id, now)));
  assert.equal(results.filter((r) => r === "resolved").length, 1, JSON.stringify(results));
  assert.equal((await challengeEvents(x.id)).length, 1);
  assert.equal((await challengeEvents(y.id)).length, 1);
  assert.equal((await noticesOf(x.id, "challenge_result")).length, 1);
  assert.equal((await noticesOf(y.id, "challenge_result")).length, 1);

  // Concurrent rollovers of both participants plus the job never double-apply either.
  clock = at(addDays(D0, 3));
  const r2 = await create(x, y.name);
  assert.equal((await respond(y, r2.body.id, "accept")).status, 200);
  const e2 = addDays(D0, 6);
  await bump(x.id, "MIND", 6);
  await Promise.all([rollTo(x, addDays(D0, 4)), rollTo(y, addDays(D0, 4))]);
  await Promise.all([rollTo(x, e2), rollTo(y, e2), resolveNamedChallenges(db!, after2h(e2))]);
  await resolveNamedChallenges(db!, after2h(addDays(e2, 1)));
  assert.equal((await row(r2.body.id)).status, "resolved");
  const forTwo = async (u: P) => (await challengeEvents(u.id)).filter((e) => e.refId === r2.body.id).length;
  assert.equal(await forTwo(x), 1);
  assert.equal(await forTwo(y), 1);
  assert.equal((await row(r2.body.id)).winnerId, x.id);
  assert.equal((await noticesOf(x.id, "challenge_result")).length, 2);
});

test("lock ordering: the lower user id is locked first; a rollover never blocks on a lower id it does not hold", { skip }, async () => {
  assert.deepEqual(lockOrder("b", "a"), ["a", "b"]);
  assert.deepEqual(lockOrder("a", "b"), ["a", "b"]);
  const { x, y } = await pair();
  const id = await active(x, y);
  await bump(x.id, "MIND", 6);
  const [lo, hi] = lockOrder(x.id, y.id);
  const byId = (u: string) => (u === x.id ? x : y);
  await rollTo(byId(lo), END); // the lower user rolls the end date first: deferred, the higher one has not
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  let entered!: () => void;
  const inside = new Promise<void>((r) => (entered = r));
  const holder = withUserLock(db!, lo, async () => {
    entered();
    await held;
  });
  await inside;
  // The higher user's rollover holds `hi` and may only try-lock `lo`: it finishes (no deadlock, no hang) and defers.
  let timer: NodeJS.Timeout | undefined;
  await Promise.race([
    rollTo(byId(hi), END),
    new Promise((_, rej) => {
      timer = setTimeout(() => rej(new Error("rollover blocked on a lower user lock")), 8000);
    }),
  ]);
  clearTimeout(timer);
  assert.equal((await row(id)).status, "active");
  release();
  await holder;
  assert.equal(await resolveChallengeById(db!, id, after2h(END)), "resolved");
  assert.equal((await row(id)).status, "resolved");
});

test("the social job rolls both participants and resolves a due challenge", { skip }, async () => {
  const { x, y } = await pair();
  const id = await active(x, y);
  await bump(y.id, "MIND", 6);
  // The job only takes windows that ended before today (UTC): the day after the end date.
  const out = await runSocialJobs(db!, after2h(addDays(END, 1)));
  assert.notEqual(out.challenges, "skipped");
  const r = await row(id);
  assert.equal(r.status, "resolved");
  assert.equal(r.winnerId, y.id);
});

// --- shame mode -----------------------------------------------------------------------------------------

async function mkQuest(userId: string, title: string, expiresAt: Date, shameMode = false) {
  const [q] = await db!.insert(quests).values({ userId, type: "daily", title, description: "d", domain: "MIND", expiresAt, shameMode }).returning();
  return q!;
}
const shame = (p: P, questId: string, enabled: boolean) => request(a()).patch(`/api/quests/${questId}/shame`).set(auth(p.token)).send({ enabled });

test("PATCH /quests/:id/shame: PRO, in a clan, own active quest", { skip }, async () => {
  clock = at(D0);
  const u = await mk("uma_1");
  const free = await mk("fay_1", { pro: false });
  const mate = await mk("mal_1");
  const q = await mkQuest(u.id, "Read 20 pages", endOfLocalDay(D0, TZ));
  assert.equal((await shame(free, q.id, true)).status, 402);
  const noClan = await shame(u, q.id, true);
  assert.equal(noClan.status, 409);
  assert.equal(noClan.body.code, "not_in_clan");
  await clanOf(u, mate);
  assert.equal((await shame(mate, q.id, true)).status, 404); // not their quest
  assert.equal((await shame(u, "00000000-0000-4000-8000-000000000000", true)).status, 404);
  const on = await shame(u, q.id, true);
  assert.equal(on.status, 200, JSON.stringify(on.body));
  assert.equal(assertContract(QuestSchema, on.body.quest).shameMode, true);
  const off = await shame(u, q.id, false);
  assert.equal(off.status, 200);
  assert.equal(off.body.quest.shameMode, false);
  const done = await mkQuest(u.id, "Old", endOfLocalDay(D0, TZ));
  await db!.update(quests).set({ status: "complete" }).where(eq(quests.id, done.id));
  assert.equal((await shame(u, done.id, true)).status, 409);
  // disabling needs no PRO: a lapsed subscriber can always turn it off
  await db!.update(quests).set({ shameMode: true }).where(eq(quests.id, q.id));
  await grantEntitlement(db!, u.id, "free", null, new Date());
  assert.equal((await shame(u, q.id, true)).status, 402);
  assert.equal((await shame(u, q.id, false)).status, 200);
});

test("a failed shame quest notifies every clanmate once; others, non-shame quests and other clans get nothing", { skip }, async () => {
  clock = at(D0);
  const u = await mk("uma_1"); // anonymous: the clan still sees the username
  const m1 = await mk("mal_1");
  const m2 = await mk("mia_1");
  const outsider = await mk("olga_1");
  await clanOf(u, m1, m2);
  await clanOf(outsider);
  await mkQuest(u.id, "Run 5k", endOfLocalDay(D0, TZ), true);
  await mkQuest(u.id, "Quiet one", endOfLocalDay(D0, TZ), false);
  await rollTo(u, D0);
  for (const m of [m1, m2]) {
    const n = await noticesOf(m.id, "shame");
    assert.equal(n.length, 1);
    assert.deepEqual(n[0]!.payload, { handle: "uma_1", questTitle: "Run 5k" });
  }
  assert.equal((await noticesOf(u.id, "shame")).length, 0);
  assert.equal((await noticesOf(outsider.id, "shame")).length, 0);
  // exactly once: rolling more days adds nothing
  await rollTo(u, addDays(D0, 2));
  assert.equal((await noticesOf(m1.id, "shame")).length, 1);
  assert.equal((await noticesOf(m2.id, "shame")).length, 1);
});

test("a shame quest that was completed, or whose owner left the clan, notifies nobody", { skip }, async () => {
  clock = at(D0);
  const u = await mk("uma_1");
  const m1 = await mk("mal_1");
  await clanOf(u, m1);
  const done = await mkQuest(u.id, "Done", endOfLocalDay(D0, TZ), true);
  await db!.update(quests).set({ status: "complete", resolvedAt: new Date(), resolvedLocalDate: D0 }).where(eq(quests.id, done.id));
  await mkQuest(u.id, "Left", endOfLocalDay(D0, TZ), true);
  await db!.delete(clanMembers).where(eq(clanMembers.userId, u.id));
  await rollTo(u, D0);
  assert.equal((await noticesOf(m1.id, "shame")).length, 0);
});

// --- fix round 1 ----------------------------------------------------------------------------------------

test("start values come from each player's own snapshot of the day before the window (the accept day), even if the challenger had an unrolled day", { skip }, async () => {
  const { x, y } = await pair();
  // x has unrolled days before the window: onboarded 3 days earlier, never rolled, with a daily quest that expired on D0-1.
  await db!.update(profiles).set({ onboardedAt: at(addDays(D0, -3), "09:00") }).where(eq(profiles.userId, x.id));
  await db!.update(userDayState).set({ lastRolledDate: null, nextRolloverAt: endOfLocalDay(addDays(D0, -3), TZ) }).where(eq(userDayState.userId, x.id));
  await db!.delete(dailySnapshots).where(eq(dailySnapshots.userId, x.id));
  await mkQuest(x.id, "Missed", endOfLocalDay(addDays(D0, -1), TZ));
  await setScore(x.id, "DISCIPLINE", 50);
  clock = at(D0);
  const before = await scoreOf(x.id, "DISCIPLINE");
  const res = await create(x, y.name, { domain: "DISCIPLINE" });
  const acc = await respond(y, res.body.id, "accept");
  assert.equal(acc.status, 200, JSON.stringify(acc.body));
  let r = await row(res.body.id);
  assert.equal(r.challengerStart, null, "x has unrolled days: its start waits for its own snapshot");
  assert.equal(r.opponentStart, await scoreOf(y.id, "DISCIPLINE"), "y has nothing to roll: its live score is the start");

  await rollTo(x, END);
  await rollTo(y, END);
  r = await row(res.body.id);
  assert.equal(r.status, "resolved");
  const [snap] = await db!.select().from(dailySnapshots).where(and(eq(dailySnapshots.userId, x.id), eq(dailySnapshots.localDate, D0)));
  const expected = Math.round((snap!.scores as Record<string, number>).DISCIPLINE! * 100) / 100;
  assert.equal(r.challengerStart, expected);
  assert.ok(expected < before, "the missed quest's penalty is in the snapshot, not in a live capture");
});

test("result score events for the rollover holder are dated with the date being rolled", { skip }, async () => {
  const { x, y } = await pair();
  const id = await active(x, y);
  await bump(x.id, "MIND", 6);
  await rollTo(y, END);
  // x catches up over several days in one pass: the result lands while END is being rolled.
  await ensureRolledOver(db!, x.id, after2h(addDays(END, 4)));
  assert.equal((await row(id)).status, "resolved");
  const ex = await challengeEvents(x.id);
  assert.equal(ex.length, 1);
  assert.equal(ex[0]!.localDate, END);
});

test("accept after the challenger unfollowed -> 409 not_pending and the challenge is voided", { skip }, async () => {
  const { x, y } = await pair();
  clock = at(D0);
  const res = await create(x, y.name);
  await db!.delete(follows).where(eq(follows.followerId, x.id));
  const acc = await respond(y, res.body.id, "accept");
  assert.equal(acc.status, 409);
  assert.equal(acc.body.code, "not_pending");
  assert.match(acc.body.error, /withdrawn/i);
  assert.equal((await row(res.body.id)).status, "void");
});

test("the job rotates: an attempted challenge goes to the back, so a stuck one cannot starve the rest", { skip }, async () => {
  const x = await mk("xena_1");
  const ys = [await mk("ya_1", { identity: "public" }), await mk("yb_1", { identity: "public" })];
  for (const y of ys) await follow(x, y);
  clock = at(D0);
  const ids: string[] = [];
  for (const y of ys) {
    const r = await create(x, y.name);
    assert.equal((await respond(y, r.body.id, "accept")).status, 200);
    ids.push(r.body.id);
  }
  const now = after2h(addDays(END, 1));
  const seen: string[] = [];
  const stuckFirst = async (_db: unknown, id: string) => {
    seen.push(id);
    return id === ids[0] ? ("deferred" as const) : ("resolved" as const);
  };
  await resolveNamedChallenges(db!, now, 1, { resolve: stuckFirst as never });
  await resolveNamedChallenges(db!, now, 1, { resolve: stuckFirst as never });
  assert.deepEqual([...seen].sort(), [...ids].sort(), "both challenges were attempted within two limit-1 passes");
  assert.ok((await row(ids[0]!)).lastAttemptAt);
});

// --- window after acceptance, start fallbacks, clan dispatches (task 7 carried items) --------------------------

const HS = addDays(D0, 10); // window start of the history cases
const HE = addDays(HS, 2);

/** An active row with unknown starts, both players rolled through the end date: the start comes from startFromHistory. */
async function historyCase(snaps: Array<[string, number]>, live: number, endSnapshot = true) {
  const { x, y } = await pair();
  for (const u of [x, y]) {
    await db!.delete(dailySnapshots).where(eq(dailySnapshots.userId, u.id));
    await db!.update(userDayState).set({ lastRolledDate: HE }).where(eq(userDayState.userId, u.id));
  }
  const snap = (userId: string, date: string, v: number) =>
    db!.insert(dailySnapshots).values({ userId, localDate: date, scores: { MIND: v }, hidden: 0, rank: "E" });
  for (const [date, v] of snaps) await snap(x.id, date, v);
  if (endSnapshot) await snap(x.id, HE, 50);
  await snap(y.id, addDays(HS, -1), 7);
  await snap(y.id, HE, 9);
  await setScore(x.id, "MIND", live);
  const [c] = await db!
    .insert(namedChallenges)
    .values({ challengerId: x.id, opponentId: y.id, domain: "MIND", days: 3, status: "active", respondBy: at(D0), startDate: HS, endDate: HE })
    .returning();
  assert.equal(await resolveChallengeById(db!, c!.id, after2h(HE)), "resolved");
  return row(c!.id);
}

test("start fallback: the latest snapshot before the window when the day before has none", { skip }, async () => {
  const r = await historyCase([[addDays(HS, -6), 5], [addDays(HS, -3), 10]], 99);
  assert.equal(r.challengerStart, 10);
  assert.equal(r.challengerEnd, 50);
});

test("start fallback: the earliest snapshot when none is earlier than the window", { skip }, async () => {
  const r = await historyCase([[addDays(HS, 1), 20]], 99);
  assert.equal(r.challengerStart, 20);
});

test("start fallback: the live score when the user has no snapshot at all", { skip }, async () => {
  const r = await historyCase([], 77, false);
  assert.equal(r.challengerStart, 77);
  assert.equal(r.challengerEnd, 77);
});

/** The clan's challenge dispatches as its members read them (rendered at read time), oldest first. */
const dispatchTexts = async (clanId: string) =>
  (await recentDispatches(db!, clanId, clock, 50))
    .filter((d) => d.kind === "challenge")
    .reverse()
    .map((d) => d.text);

test("accept and result post a clan dispatch to each participant's clan, with handles by that clan's view and no numbers", { skip }, async () => {
  const x = await mk("xena_1"); // semi-public (codename outside)
  const y = await mk("yuri_1", { identity: "public" });
  const z = await mk("zed_1");
  const clanX = await clanOf(x);
  const clanY = await clanOf(y, z);
  await follow(x, y);
  clock = at(D0);
  const res = await create(x, y.name);
  assert.equal((await respond(y, res.body.id, "accept")).status, 200);
  // x's clan sees x by username and y by projection (public: username); y's clan sees x by codename (semi-public outsider).
  assert.deepEqual(await dispatchTexts(clanX), ["CHALLENGE — xena_1 vs yuri_1 — MIND, 3 days."]);
  assert.deepEqual(await dispatchTexts(clanY), [`CHALLENGE — ${x.codename} vs yuri_1 — MIND, 3 days.`]);

  await bump(x.id, "MIND", 6);
  await rollTo(x, END);
  await rollTo(y, END);
  assert.equal((await row(res.body.id)).winnerId, x.id);
  assert.deepEqual(await dispatchTexts(clanX), ["CHALLENGE — xena_1 vs yuri_1 — MIND, 3 days.", "CHALLENGE RESULT — xena_1 took MIND."]);
  assert.deepEqual((await dispatchTexts(clanY)).slice(1), [`CHALLENGE RESULT — ${x.codename} took MIND.`]);
  for (const t of [...(await dispatchTexts(clanX)), ...(await dispatchTexts(clanY))]) assert.ok(!/d+(.d+)?s*(pts|points)|[+-]d/.test(t.replace(/d+ days/, "")), t);
});

test("one dispatch when both share a clan; a draw reads 'draw in DOMAIN'; no clan, no dispatch", { skip }, async () => {
  const { x, y } = await pair();
  const clanId = await clanOf(x, y);
  clock = at(D0);
  const res = await create(x, y.name);
  assert.equal((await respond(y, res.body.id, "accept")).status, 200);
  await rollTo(x, END);
  await rollTo(y, END);
  assert.deepEqual(await dispatchTexts(clanId), ["CHALLENGE — xena_1 vs yuri_1 — MIND, 3 days.", "CHALLENGE RESULT — draw in MIND."]);

  const lone = await pair2();
  clock = at(D0);
  const r2 = await create(lone.x, lone.y.name);
  assert.equal((await respond(lone.y, r2.body.id, "accept")).status, 200);
  assert.equal((await db!.select().from(clanDispatches).where(eq(clanDispatches.kind, "challenge"))).length, 2);
});
async function pair2() {
  const x = await mk("xavier_1");
  const y = await mk("yara_1", { identity: "public" });
  await follow(x, y);
  return { x, y };
}
