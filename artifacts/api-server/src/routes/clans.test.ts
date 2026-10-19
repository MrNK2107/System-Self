import test, { after, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { eq } from "drizzle-orm";
import { closeTestDb, resetDb } from "@workspace/db/testing";
import { clanDispatches, clanMembers, clans, domainScores, jobRuns, logs, profiles, quests, users } from "@workspace/db";
import { RANKED_DOMAINS, addDays, localDate, type RankedDomain } from "@workspace/engine";
import {
  ClanLeaderboardResponseSchema,
  ClanSchema,
  ClanSearchResponseSchema,
  MyClanResponseSchema,
  PublicProfileListSchema,
  type MyClanResponse,
} from "@workspace/contracts";
import { app, assertContract, assertStoredNoticesMatchContract, auth, db, setup, skip, TZ } from "./game-test-helpers";
import { grantEntitlement } from "../services/entitlements";
import { hiddenAndTrajectory } from "../services/state";
import { flagDeadWeight, recomputeClanScores, runSocialJobs } from "../jobs/social";
import { loadProjectionSubjects, projectUser } from "../services/projection";

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

type Identity = "anonymous" | "semi-public" | "public";
interface U {
  token: string;
  id: string;
  name: string;
}

async function mk(name: string, identity: Identity = "anonymous"): Promise<U> {
  const { token, id } = await setup(a(), { email: `${name}@example.com`, username: name });
  if (identity !== "anonymous") {
    assert.equal((await request(a()).patch("/api/profile").set(auth(token)).send({ identitySetting: identity })).status, 200);
  }
  return { token, id, name };
}

async function makePro(u: U, verified = true) {
  await grantEntitlement(db!, u.id, "pro", null, new Date());
  if (verified) await db!.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, u.id));
}

async function create(u: U, name = "Iron Wolves", tag = "IRON") {
  const res = await request(a()).post("/api/clans").set(auth(u.token)).send({ name, tag, description: "We log." });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return assertContract(ClanSchema, res.body);
}

let bareN = 0;
/** Inserts `n` bare users (no onboarding) straight into the clan; each logs on `logOn` when given. */
async function fill(clanId: string, n: number, logOn?: string) {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const [u] = await db!
      .insert(users)
      .values({ email: `bare${bareN}@x.com`, passwordHash: "h", username: `bare_${bareN++}`, birthYear: 1990, timezone: TZ, termsAcceptedAt: new Date() })
      .returning();
    await db!.insert(clanMembers).values({ userId: u!.id, clanId, role: "member", joinedAt: OLD_JOIN });
    if (logOn) await addLog(u!.id, logOn);
    ids.push(u!.id);
  }
  return ids;
}

/** A join date well before any activity window the tests use. */
const OLD_JOIN = new Date("2026-09-01T00:00:00Z");
/** Backdates a membership so the dead-weight rule (in the clan for the whole window) can apply. */
const ageMembership = (userId: string) => db!.update(clanMembers).set({ joinedAt: OLD_JOIN }).where(eq(clanMembers.userId, userId));

/** Holds the clan row FOR UPDATE until `release()` so requests queue on it in the order they are sent. */
async function holdClanRow(clanId: string) {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  let locked!: () => void;
  const isLocked = new Promise<void>((r) => (locked = r));
  const done = db!.transaction(async (tx) => {
    await tx.select().from(clans).where(eq(clans.id, clanId)).for("update");
    locked();
    await gate;
  });
  await isLocked;
  return { release: async () => (release(), await done) };
}
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

const join = (u: U, clanId: string) => request(a()).post(`/api/clans/${clanId}/join`).set(auth(u.token)).send({});
const mine = async (u: U): Promise<MyClanResponse> => {
  const res = await request(a()).get("/api/clans/mine").set(auth(u.token));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return assertContract(MyClanResponseSchema, res.body);
};
const clanRow = async (id: string) => (await db!.select().from(clans).where(eq(clans.id, id)))[0]!;

async function addLog(userId: string, date: string) {
  await db!.insert(logs).values({
    userId,
    clientId: `log-${Math.random()}`,
    domain: "BODY",
    logType: "x",
    occurredAt: new Date(`${date}T12:00:00+05:30`),
    localDate: date,
  });
}

// --- creation ----------------------------------------------------------------------------------

test("free user can't create (402)", { skip }, async () => {
  clock = new Date();
  const u = await mk("free_1");
  await db!.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, u.id));
  const res = await request(a()).post("/api/clans").set(auth(u.token)).send({ name: "Iron Wolves", tag: "IRON" });
  assert.equal(res.status, 402);
  assert.equal(res.body.code, "pro_required");
  assert.equal((await db!.select().from(clans)).length, 0);
});

test("pro without a verified email can't create (403 email_unverified)", { skip }, async () => {
  clock = new Date();
  const u = await mk("pro_1");
  await makePro(u, false);
  const res = await request(a()).post("/api/clans").set(auth(u.token)).send({ name: "Iron Wolves", tag: "IRON" });
  assert.equal(res.status, 403);
  assert.equal(res.body.code, "email_unverified");
});

test("pro + verified can create: creator is the leader of a forming clan", { skip }, async () => {
  clock = new Date();
  const u = await mk("pro_1");
  await makePro(u);
  const clan = await create(u);
  assert.equal(clan.name, "Iron Wolves");
  assert.equal(clan.tag, "IRON");
  assert.equal(clan.description, "We log.");
  assert.equal(clan.status, "forming");
  assert.equal(clan.memberCount, 1);
  assert.equal(clan.clanRank, null);
  assert.equal(clan.myRole, "leader");
  assert.match(clan.inviteCode, /^[A-Z0-9]{8}$/);
  const body = await mine(u);
  assert.equal(body.clan!.id, clan.id);
  assert.equal(body.members.length, 1);
  assert.equal(body.members[0]!.role, "leader");
  assert.equal(body.members[0]!.isSelf, true);
  assert.ok(body.dispatches.length >= 1);
  assert.equal(body.raid, null);

  // name unique case-insensitively; bad name / tag rejected
  const v = await mk("pro_2");
  await makePro(v);
  const dup = await request(a()).post("/api/clans").set(auth(v.token)).send({ name: "iron WOLVES", tag: "WOLF" });
  assert.equal(dup.status, 409);
  assert.equal(dup.body.code, "name_taken");
  assert.equal((await request(a()).post("/api/clans").set(auth(v.token)).send({ name: "ab", tag: "WOLF" })).status, 400);
  assert.equal((await request(a()).post("/api/clans").set(auth(v.token)).send({ name: "Bad!Name", tag: "WOLF" })).status, 400);
  assert.equal((await request(a()).post("/api/clans").set(auth(v.token)).send({ name: "Good Name", tag: "wolf" })).status, 400);
  assert.equal((await request(a()).post("/api/clans").set(auth(v.token)).send({ name: "Good Name", tag: "W" })).status, 400);
});

test("a user without a clan gets an empty /mine", { skip }, async () => {
  clock = new Date();
  const u = await mk("solo_1");
  assert.deepEqual(await mine(u), { clan: null, members: [], dispatches: [], raid: null });
});

// --- membership --------------------------------------------------------------------------------

test("user already in a clan → 409 already_in_clan (join, invite join, create)", { skip }, async () => {
  clock = new Date();
  const l1 = await mk("lead_1");
  const l2 = await mk("lead_2");
  await makePro(l1);
  await makePro(l2);
  const c1 = await create(l1, "Iron Wolves", "IRON");
  const c2 = await create(l2, "Night Owls", "OWL");
  const u = await mk("mem_1");
  assert.equal((await join(u, c1.id)).status, 204);
  const again = await join(u, c2.id);
  assert.equal(again.status, 409);
  assert.equal(again.body.code, "already_in_clan");
  const byCode = await request(a()).post("/api/clans/join").set(auth(u.token)).send({ inviteCode: c2.inviteCode });
  assert.equal(byCode.status, 409);
  assert.equal(byCode.body.code, "already_in_clan");
  await makePro(u);
  const made = await request(a()).post("/api/clans").set(auth(u.token)).send({ name: "Third Clan", tag: "THR" });
  assert.equal(made.status, 409);
  assert.equal(made.body.code, "already_in_clan");
});

test("join by invite code (case-insensitive); unknown code or clan → 404", { skip }, async () => {
  clock = new Date();
  const l = await mk("lead_1");
  await makePro(l);
  const c = await create(l);
  const u = await mk("mem_1");
  const bad = await request(a()).post("/api/clans/join").set(auth(u.token)).send({ inviteCode: "NOPE9999" });
  assert.equal(bad.status, 404);
  assert.equal((await join(u, "00000000-0000-4000-8000-000000000000")).status, 404);
  const ok = await request(a()).post("/api/clans/join").set(auth(u.token)).send({ inviteCode: c.inviteCode.toLowerCase() });
  assert.equal(ok.status, 204);
  assert.equal((await mine(u)).clan!.id, c.id);
  assert.equal((await mine(u)).clan!.myRole, "member");
});

test("join when full → 409 clan_full (the 31st member)", { skip }, async () => {
  clock = new Date();
  const l = await mk("lead_1");
  await makePro(l);
  const c = await create(l);
  await fill(c.id, 29);
  const u = await mk("late_1");
  const res = await join(u, c.id);
  assert.equal(res.status, 409);
  assert.equal(res.body.code, "clan_full");
  assert.equal((await db!.select().from(clanMembers).where(eq(clanMembers.clanId, c.id))).length, 30);
});

test("concurrent joins never take a clan past 30 members", { skip }, async () => {
  clock = new Date();
  const l = await mk("lead_1");
  await makePro(l);
  const c = await create(l);
  await fill(c.id, 27); // 28 members: room for 2
  const joiners = [await mk("j_1"), await mk("j_2"), await mk("j_3"), await mk("j_4")];
  const results = await Promise.all(joiners.map((u) => join(u, c.id)));
  assert.equal(results.filter((r) => r.status === 204).length, 2);
  assert.equal(results.filter((r) => r.status === 409 && r.body.code === "clan_full").length, 2);
  assert.equal((await db!.select().from(clanMembers).where(eq(clanMembers.clanId, c.id))).length, 30);
});

test("a block between the joiner and a member refuses the join (403 blocked)", { skip }, async () => {
  clock = new Date();
  const l = await mk("lead_1", "public");
  await makePro(l);
  const c = await create(l);
  const u = await mk("mem_1");
  assert.equal((await request(a()).post(`/api/social/block/lead_1`).set(auth(u.token)).send({})).status, 204);
  const res = await join(u, c.id);
  assert.equal(res.status, 403);
  assert.equal(res.body.code, "blocked");
});

test("forming→active at 8 members, and back to forming below 8", { skip }, async () => {
  clock = new Date();
  const l = await mk("lead_1");
  await makePro(l);
  const c = await create(l);
  await fill(c.id, 6); // 7 members
  assert.equal((await clanRow(c.id)).status, "forming");
  const u = await mk("eighth");
  assert.equal((await join(u, c.id)).status, 204);
  assert.equal((await clanRow(c.id)).status, "active");
  assert.equal((await mine(u)).clan!.status, "active");
  assert.equal((await mine(u)).clan!.memberCount, 8);
  assert.equal((await request(a()).post("/api/clans/leave").set(auth(u.token)).send({})).status, 204);
  const row = await clanRow(c.id);
  assert.equal(row.status, "forming");
  assert.equal(row.clanRank, null);
  assert.equal((await mine(u)).clan, null);
});

test("leader leave with members → 409 leader_must_transfer; transfer, then leave", { skip }, async () => {
  clock = new Date();
  const l = await mk("lead_1");
  await makePro(l);
  const c = await create(l);
  const u = await mk("mem_1");
  const outsider = await mk("out_1");
  assert.equal((await join(u, c.id)).status, 204);
  const leave = await request(a()).post("/api/clans/leave").set(auth(l.token)).send({});
  assert.equal(leave.status, 409);
  assert.equal(leave.body.code, "leader_must_transfer");

  // only the leader transfers, only to a member of the clan
  const notLeader = await request(a()).post("/api/clans/leader").set(auth(u.token)).send({ userId: l.id });
  assert.equal(notLeader.status, 403);
  assert.equal(notLeader.body.code, "not_leader");
  assert.equal((await request(a()).post("/api/clans/leader").set(auth(l.token)).send({ userId: outsider.id })).status, 404);

  assert.equal((await request(a()).post("/api/clans/leader").set(auth(l.token)).send({ userId: u.id })).status, 204);
  assert.equal((await mine(u)).clan!.myRole, "leader");
  assert.equal((await mine(l)).clan!.myRole, "member");
  assert.equal((await request(a()).post("/api/clans/leave").set(auth(l.token)).send({})).status, 204);
  assert.equal((await mine(l)).clan, null);

  // the last member (the leader) leaving disbands the clan
  assert.equal((await request(a()).post("/api/clans/leave").set(auth(u.token)).send({})).status, 204);
  assert.equal((await db!.select().from(clans)).length, 0);
  const none = await request(a()).post("/api/clans/leave").set(auth(u.token)).send({});
  assert.equal(none.status, 409);
  assert.equal(none.body.code, "not_in_clan");
});

test("remove non-flagged → 409 not_flagged; a flagged inactive member can be removed by the leader only", { skip }, async () => {
  clock = new Date();
  const l = await mk("lead_1");
  await makePro(l);
  const c = await create(l);
  const u = await mk("mem_1");
  const v = await mk("mem_2");
  assert.equal((await join(u, c.id)).status, 204);
  assert.equal((await join(v, c.id)).status, 204);

  const res = await request(a()).post(`/api/clans/members/${u.id}/remove`).set(auth(l.token)).send({});
  assert.equal(res.status, 409);
  assert.equal(res.body.code, "not_flagged");

  await ageMembership(u.id);
  await db!.update(clanMembers).set({ flaggedAt: new Date() }).where(eq(clanMembers.userId, u.id));
  const byMember = await request(a()).post(`/api/clans/members/${u.id}/remove`).set(auth(v.token)).send({});
  assert.equal(byMember.status, 403);
  assert.equal(byMember.body.code, "not_leader");
  assert.equal((await request(a()).post(`/api/clans/members/${l.id}/remove`).set(auth(l.token)).send({})).status, 400);

  assert.ok((await mine(l)).members.find((m) => m.userId === u.id)!.flagged);
  assert.equal((await request(a()).post(`/api/clans/members/${u.id}/remove`).set(auth(l.token)).send({})).status, 204);
  assert.equal((await mine(u)).clan, null);
  assert.equal((await mine(l)).clan!.memberCount, 2);
});

test("a flagged member who logged again is no longer removable (flag cleared)", { skip }, async () => {
  clock = new Date();
  const l = await mk("lead_1");
  await makePro(l);
  const c = await create(l);
  const u = await mk("mem_1");
  assert.equal((await join(u, c.id)).status, 204);
  await ageMembership(u.id);
  await db!.update(clanMembers).set({ flaggedAt: new Date() }).where(eq(clanMembers.userId, u.id));
  await addLog(u.id, addDays(localDate(clock, TZ), -1)); // inside the window (ends yesterday)
  assert.equal((await mine(l)).members.find((m) => m.userId === u.id)!.flagged, false);
  const res = await request(a()).post(`/api/clans/members/${u.id}/remove`).set(auth(l.token)).send({});
  assert.equal(res.status, 409);
  assert.equal(res.body.code, "not_flagged");
  assert.equal((await db!.select().from(clanMembers).where(eq(clanMembers.userId, u.id)))[0]!.flaggedAt, null);
});

test("a fresh joiner with no logs is not dead weight (flag job and remove use the join date)", { skip }, async () => {
  const now = new Date("2026-10-19T00:31:00Z");
  clock = now;
  const l = await mk("lead_1");
  await makePro(l);
  const c = await create(l);
  await ageMembership(l.id);
  await addLog(l.id, "2026-10-18");
  clock = new Date("2026-10-17T06:00:00Z"); // u joins two days before the run
  const u = await mk("mem_1");
  assert.equal((await join(u, c.id)).status, 204);
  clock = now;
  assert.deepEqual(await flagDeadWeight(db!, now), { flagged: 0, cleared: 0 });
  // a stale flag on a fresh joiner does not make them removable either
  await db!.update(clanMembers).set({ flaggedAt: new Date() }).where(eq(clanMembers.userId, u.id));
  assert.equal((await mine(l)).members.find((m) => m.userId === u.id)!.flagged, false);
  const res = await request(a()).post(`/api/clans/members/${u.id}/remove`).set(auth(l.token)).send({});
  assert.equal(res.status, 409);
  assert.equal(res.body.code, "not_flagged");
  // joined on the first day of the window (10-14 local) or earlier: dead weight
  await db!.update(clanMembers).set({ joinedAt: new Date("2026-10-14T06:00:00+05:30"), flaggedAt: null }).where(eq(clanMembers.userId, u.id));
  await db!.delete(jobRuns);
  assert.deepEqual(await flagDeadWeight(db!, now), { flagged: 1, cleared: 0 });
});

test("a transfer racing the heir's leave never leaves the clan without a leader", { skip }, async () => {
  clock = new Date();
  const l = await mk("lead_1");
  await makePro(l);
  const c = await create(l);
  const b = await mk("mem_b");
  assert.equal((await join(b, c.id)).status, 204);
  const hold = await holdClanRow(c.id);
  const transfer = request(a()).post("/api/clans/leader").set(auth(l.token)).send({ userId: b.id }).then((r) => r);
  await pause(250);
  const leave = request(a()).post("/api/clans/leave").set(auth(b.token)).send({}).then((r) => r);
  await pause(250);
  await hold.release();
  const [t, lv] = await Promise.all([transfer, leave]);
  assert.equal(t.status, 204);
  assert.equal(lv.status, 409);
  assert.equal(lv.body.code, "leader_must_transfer");
  const rows = await db!.select().from(clanMembers).where(eq(clanMembers.clanId, c.id));
  assert.equal(rows.length, 2);
  assert.equal(rows.filter((r) => r.role === "leader").length, 1);
});

test("a leave racing a removal answers not_in_clan and posts no LEFT dispatch", { skip }, async () => {
  clock = new Date();
  const l = await mk("lead_1");
  await makePro(l);
  const c = await create(l);
  const u = await mk("mem_1");
  assert.equal((await join(u, c.id)).status, 204);
  await ageMembership(u.id);
  await db!.update(clanMembers).set({ flaggedAt: new Date() }).where(eq(clanMembers.userId, u.id));
  const hold = await holdClanRow(c.id);
  const remove = request(a()).post(`/api/clans/members/${u.id}/remove`).set(auth(l.token)).send({}).then((r) => r);
  await pause(250);
  const leave = request(a()).post("/api/clans/leave").set(auth(u.token)).send({}).then((r) => r);
  await pause(250);
  await hold.release();
  const [rm, lv] = await Promise.all([remove, leave]);
  assert.equal(rm.status, 204);
  assert.equal(lv.status, 409);
  assert.equal(lv.body.code, "not_in_clan");
  const kinds = (await db!.select().from(clanDispatches).where(eq(clanDispatches.clanId, c.id))).map((d) => d.kind);
  assert.ok(!kinds.includes("left"), kinds.join(","));
});

// --- members payload ---------------------------------------------------------------------------

test("members payload uses usernames even for semi-public and anonymous members; no hidden score", { skip }, async () => {
  clock = new Date();
  const l = await mk("lead_1", "public");
  await makePro(l);
  const c = await create(l);
  const semi = await mk("semi_1", "semi-public");
  const anon = await mk("anon_1", "anonymous");
  assert.equal((await join(semi, c.id)).status, 204);
  assert.equal((await join(anon, c.id)).status, 204);

  const today = localDate(clock, TZ);
  const q = (status: string, title: string) => ({
    userId: semi.id,
    type: "daily",
    title,
    description: "secret description",
    domain: "MIND",
    status,
    expiresAt: clock,
    resolvedAt: clock,
    resolvedLocalDate: today,
  });
  await db!.insert(quests).values([q("complete", "SECRET-QUEST-A"), q("complete", "SECRET-QUEST-B"), q("complete", "SECRET-QUEST-C"), q("failed", "SECRET-QUEST-D")]);

  const body = await mine(anon);
  const byName = new Map(body.members.map((m) => [m.profile.handle, m]));
  for (const u of [l, semi, anon]) {
    const m = byName.get(u.name);
    assert.ok(m, `member ${u.name} shown by username`);
    assert.equal(m!.profile.isCodename, false);
    assert.equal(m!.profile.clanTag, "IRON");
    assert.deepEqual(Object.keys(m!.profile.scores!).sort(), [...RANKED_DOMAINS].sort());
  }
  assert.equal(byName.get("semi_1")!.questCompletionRate30d, 75);
  assert.equal(byName.get("lead_1")!.questCompletionRate30d, null);
  assert.equal(body.members[0]!.role, "leader");
  assert.equal(byName.get("anon_1")!.isSelf, true);

  const text = JSON.stringify(body);
  for (const forbidden of ["SECRET-QUEST", "secret description", "@example.com"]) assert.ok(!text.includes(forbidden), `leaks ${forbidden}`);
  const walk = (v: unknown, path: string) => {
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
    else if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) {
        assert.ok(!/hidden|email|refusal|lifeContext/i.test(k), `forbidden key at ${path}.${k}`);
        walk(x, `${path}.${k}`);
      }
    }
  };
  walk(body, "$");
});

test("projection: clan tag is shown externally except for anonymous members and never to a rival", { skip }, async () => {
  clock = new Date();
  const l = await mk("lead_1", "public");
  await makePro(l);
  const c = await create(l);
  const anon = await mk("anon_1", "anonymous");
  const semi = await mk("semi_1", "semi-public");
  assert.equal((await join(anon, c.id)).status, 204);
  assert.equal((await join(semi, c.id)).status, 204);
  const subjects = await loadProjectionSubjects(db!, [l.id, anon.id, semi.id], clock);
  assert.equal(projectUser(subjects.get(l.id)!, "public").clanTag, "IRON");
  assert.equal(projectUser(subjects.get(semi.id)!, "public").clanTag, "IRON");
  assert.equal(projectUser(subjects.get(anon.id)!, "public").clanTag, undefined);
  assert.equal(projectUser(subjects.get(anon.id)!, "follower").clanTag, undefined);
  assert.equal(projectUser(subjects.get(anon.id)!, "clanmate").clanTag, "IRON");
  assert.equal(projectUser(subjects.get(l.id)!, "rival").clanTag, undefined);

  // the public search shows the public leader's clan tag
  const outsider = await mk("out_1");
  const res = await request(a()).get("/api/social/search?q=lead").set(auth(outsider.token));
  assert.equal(res.status, 200);
  const list = assertContract(PublicProfileListSchema, res.body);
  assert.equal(list[0]!.clanTag, "IRON");
});

// --- search and leaderboard --------------------------------------------------------------------

test("search by name or tag; leaderboard lists ranked active clans only", { skip }, async () => {
  clock = new Date();
  const l1 = await mk("lead_1");
  const l2 = await mk("lead_2");
  await makePro(l1);
  await makePro(l2);
  const c1 = await create(l1, "Iron Wolves", "IRON");
  const c2 = await create(l2, "Night Owls", "OWL");
  await fill(c1.id, 7);
  await db!.update(clans).set({ status: "active", clanRank: 1, clanScore: 42.5, activeMemberCount: 3 }).where(eq(clans.id, c1.id));

  const s = await request(a()).get("/api/clans/search?q=wol").set(auth(l2.token));
  assert.equal(s.status, 200);
  const found = assertContract(ClanSearchResponseSchema, s.body);
  assert.deepEqual(found.items, [{ id: c1.id, name: "Iron Wolves", tag: "IRON", memberCount: 8, status: "active", clanRank: 1 }]);
  const byTag = assertContract(ClanSearchResponseSchema, (await request(a()).get("/api/clans/search?q=owl").set(auth(l1.token))).body);
  assert.deepEqual(byTag.items.map((i) => i.id), [c2.id]);
  const all = assertContract(ClanSearchResponseSchema, (await request(a()).get("/api/clans/search").set(auth(l1.token))).body);
  assert.deepEqual(all.items.map((i) => i.id), [c1.id, c2.id]);
  assert.ok(!JSON.stringify(all).includes("inviteCode"));

  const lb = await request(a()).get("/api/clans/leaderboard?limit=50").set(auth(l1.token));
  assert.equal(lb.status, 200);
  const board = assertContract(ClanLeaderboardResponseSchema, lb.body);
  assert.deepEqual(board.items, [{ id: c1.id, name: "Iron Wolves", tag: "IRON", memberCount: 8, status: "active", clanRank: 1, clanScore: 42.5 }]);

  // the own-clan DTO carries the active member count; a clan never scored has a null score
  assert.equal((await mine(l1)).clan!.activeMemberCount, 3);
  assert.equal((await mine(l2)).clan!.clanScore, null);
});

// --- daily jobs --------------------------------------------------------------------------------

test("clan score excludes members inactive ≥ 5 days and adds this month's raid bonus", { skip }, async () => {
  clock = new Date();
  const l = await mk("lead_1");
  await makePro(l);
  const c = await create(l);
  const b = await mk("mem_b");
  const d = await mk("mem_d");
  const x = await mk("mem_x");
  const t = await mk("mem_t");
  for (const u of [b, d, x, t]) assert.equal((await join(u, c.id)).status, 204);
  const setAll = async (id: string, v: number) => db!.update(domainScores).set({ score: v }).where(eq(domainScores.userId, id));
  await setAll(l.id, 40);
  await setAll(b.id, 60);
  await setAll(d.id, 50);
  await setAll(x.id, 99);
  await setAll(t.id, 98);

  const now = new Date("2026-10-19T00:31:00Z"); // 06:01 in Kolkata, local date 2026-10-19
  const today = localDate(now, TZ);
  // The window is the 5 full local days ending yesterday: today - 5 .. today - 1.
  await addLog(l.id, addDays(today, -1));
  await addLog(b.id, addDays(today, -5)); // first day of the window
  await addLog(d.id, addDays(today, -3));
  await addLog(x.id, addDays(today, -6)); // before the window: excluded
  await addLog(t.id, today); // today does not count: excluded
  await db!.update(clans).set({ raidBonusMonth: "2026-10", raidBonus: 4 }).where(eq(clans.id, c.id));

  const hiddenOf = async (id: string, v: number) =>
    (await hiddenAndTrajectory(db!, id, today, Object.fromEntries(RANKED_DOMAINS.map((d) => [d, v])) as Record<RankedDomain, number>)).hidden;
  const expected = Math.round((((await hiddenOf(l.id, 40)) + (await hiddenOf(b.id, 60)) + (await hiddenOf(d.id, 50))) / 3 + 4) * 100) / 100;

  assert.equal(await recomputeClanScores(db!, now), 1);
  const row = await clanRow(c.id);
  assert.equal(row.clanScore, expected);
  assert.equal(row.activeMemberCount, 3);
  assert.equal(row.clanRank, null); // forming clans are not ranked

  // last month's bonus does not count
  await db!.update(clans).set({ raidBonusMonth: "2026-09", scoredOn: null }).where(eq(clans.id, c.id));
  await db!.delete(jobRuns);
  assert.equal(await recomputeClanScores(db!, now), 1);
  assert.equal((await clanRow(c.id)).clanScore, Math.round((expected - 4) * 100) / 100);

  // the payload never carries a member's hidden score
  const text = JSON.stringify(await mine(l));
  assert.ok(!/hidden/i.test(text));

  // fewer than 3 active members: no clan score at all (a mean of 1-2 would expose individual hidden scores)
  await db!.delete(logs).where(eq(logs.userId, d.id));
  await db!.update(clans).set({ scoredOn: null, raidBonusMonth: "2026-10" }).where(eq(clans.id, c.id));
  await db!.delete(jobRuns);
  assert.equal(await recomputeClanScores(db!, now), 1);
  const thin = await clanRow(c.id);
  assert.equal(thin.clanScore, null);
  assert.equal(thin.activeMemberCount, 2);
  assert.equal((await mine(l)).clan!.clanScore, null);
});

test("clan scores run daily from 00:30 UTC once, and rank active clans by score", { skip }, async () => {
  clock = new Date();
  const l1 = await mk("lead_1");
  const l2 = await mk("lead_2");
  const l3 = await mk("lead_3");
  for (const u of [l1, l2, l3]) await makePro(u);
  const c1 = await create(l1, "Iron Wolves", "IRON");
  const c2 = await create(l2, "Night Owls", "OWL");
  const c3 = await create(l3, "Small Band", "SMB");
  await fill(c1.id, 2, "2026-10-18");
  await fill(c1.id, 5);
  await fill(c2.id, 2, "2026-10-18");
  await fill(c2.id, 5);
  const l4 = await mk("lead_4");
  await makePro(l4);
  const c4 = await create(l4, "Thin Line", "THN");
  await fill(c4.id, 7); // active status, but only the leader logs: not ranked
  await addLog(l4.id, "2026-10-18");
  await db!.update(domainScores).set({ score: 30 }).where(eq(domainScores.userId, l1.id));
  await db!.update(domainScores).set({ score: 70 }).where(eq(domainScores.userId, l2.id));
  await db!.update(domainScores).set({ score: 90 }).where(eq(domainScores.userId, l3.id));
  for (const u of [l1, l2, l3]) await addLog(u.id, "2026-10-18");

  assert.equal(await recomputeClanScores(db!, new Date("2026-10-19T00:10:00Z")), "not_due");
  assert.equal(await recomputeClanScores(db!, new Date("2026-10-19T00:31:00Z")), 4);
  assert.equal((await clanRow(c2.id)).clanRank, 1);
  assert.equal((await clanRow(c1.id)).clanRank, 2);
  assert.equal((await clanRow(c3.id)).clanRank, null); // forming
  assert.equal((await clanRow(c3.id)).clanScore, null); // one active member: no score
  assert.equal((await clanRow(c4.id)).status, "active");
  assert.equal((await clanRow(c4.id)).clanRank, null); // fewer than 3 active members: unranked
  assert.equal(await recomputeClanScores(db!, new Date("2026-10-19T09:00:00Z")), "not_due");
  const [run] = await db!.select().from(jobRuns).where(eq(jobRuns.job, "clan-scores"));
  assert.equal(run!.lastRunDate, "2026-10-19");

  // a time budget spent after the first clan resumes on the next tick, and ranks only once all are scored
  await db!.update(domainScores).set({ score: 10 }).where(eq(domainScores.userId, l2.id));
  let t = 0;
  const first = await recomputeClanScores(db!, new Date("2026-10-20T00:31:00Z"), { budgetMs: 1, nowMs: () => (t += 5), batchSize: 1 });
  assert.equal(first, 1);
  assert.equal((await clanRow(c2.id)).clanRank, 1); // not re-ranked yet
  assert.equal(await recomputeClanScores(db!, new Date("2026-10-20T00:32:00Z")), 3);
  assert.equal((await clanRow(c1.id)).clanRank, 1);
  assert.equal((await clanRow(c2.id)).clanRank, 2);

  const board = assertContract(ClanLeaderboardResponseSchema, (await request(a()).get("/api/clans/leaderboard").set(auth(l1.token))).body);
  assert.deepEqual(board.items.map((i) => i.id), [c1.id, c2.id]);
});

test("dead weight: flagged after 5 inactive local days, cleared when active again; daily", { skip }, async () => {
  clock = new Date();
  const l = await mk("lead_1");
  await makePro(l);
  const c = await create(l);
  const u = await mk("mem_1");
  assert.equal((await join(u, c.id)).status, 204);
  await ageMembership(l.id);
  await ageMembership(u.id);
  const now = new Date("2026-10-19T00:31:00Z");
  const today = localDate(now, TZ);
  await addLog(l.id, addDays(today, -4));
  await addLog(u.id, addDays(today, -6)); // nothing in today - 5 .. today - 1
  await addLog(u.id, today); // today does not count

  assert.equal(await flagDeadWeight(db!, new Date("2026-10-19T00:10:00Z")), "not_due");
  assert.deepEqual(await flagDeadWeight(db!, now), { flagged: 1, cleared: 0 });
  const flagOf = async (id: string) => (await db!.select().from(clanMembers).where(eq(clanMembers.userId, id)))[0]!.flaggedAt;
  assert.ok(await flagOf(u.id));
  assert.equal(await flagOf(l.id), null);
  assert.equal(await flagDeadWeight(db!, new Date("2026-10-19T12:00:00Z")), "not_due");

  await addLog(l.id, "2026-10-19"); // the 10-20 window is 10-15 .. 10-19: u's 10-19 log now counts
  assert.deepEqual(await flagDeadWeight(db!, new Date("2026-10-20T00:31:00Z")), { flagged: 0, cleared: 1 });
  assert.equal(await flagOf(u.id), null);

  // runSocialJobs runs both
  const out = await runSocialJobs(db!, new Date("2026-10-21T00:31:00Z"));
  assert.notEqual(out.deadWeight, "skipped");
  assert.notEqual(out.clanScores, "skipped");
});

test("dispatches record membership changes without emoji", { skip }, async () => {
  clock = new Date();
  const l = await mk("lead_1");
  await makePro(l);
  const c = await create(l);
  const u = await mk("mem_1");
  assert.equal((await join(u, c.id)).status, 204);
  assert.equal((await request(a()).post("/api/clans/leave").set(auth(u.token)).send({})).status, 204);
  const rows = await db!.select().from(clanDispatches).where(eq(clanDispatches.clanId, c.id));
  assert.equal(rows.length, 3);
  const body = await mine(l);
  assert.equal(body.dispatches.length, 3);
  assert.ok(body.dispatches.some((d) => d.text.includes("mem_1")));
  for (const d of body.dispatches) assert.ok(!/\p{Extended_Pictographic}/u.test(d.text), d.text);
  // profiles untouched
  assert.ok((await db!.select().from(profiles)).length >= 2);
});

test("the daily pass repairs a clan whose leader account was deleted, and drops empty clans", { skip }, async () => {
  clock = new Date();
  const l = await mk("lead_1");
  const l2 = await mk("lead_2");
  await makePro(l);
  await makePro(l2);
  const c = await create(l);
  const lonely = await create(l2, "Lone Clan", "LONE");
  const u = await mk("mem_1");
  const v = await mk("mem_2");
  assert.equal((await join(u, c.id)).status, 204);
  clock = new Date(clock.getTime() + 1000); // v joins later: u is the longest-standing member
  assert.equal((await join(v, c.id)).status, 204);
  await db!.delete(users).where(eq(users.id, l.id));
  await db!.delete(users).where(eq(users.id, l2.id));
  assert.equal(await recomputeClanScores(db!, new Date("2026-10-19T00:31:00Z")), 1);
  assert.equal((await mine(u)).clan!.myRole, "leader");
  assert.equal((await mine(v)).clan!.myRole, "member");
  assert.equal((await db!.select().from(clans).where(eq(clans.id, lonely.id))).length, 0);
});
