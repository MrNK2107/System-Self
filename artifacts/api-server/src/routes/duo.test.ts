import test, { after, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { and, count, eq } from "drizzle-orm";
import { closeTestDb, resetDb } from "@workspace/db/testing";
import { blocks, domainScores, duoCheckins, duoInvites, duoMembers, duos, notices, profiles, scoreEvents, users } from "@workspace/db";
import { DuoCheckinResponseSchema, DuoInviteResponseSchema, DuoResponseSchema } from "@workspace/contracts";
import { app, assertContract, assertStoredNoticesMatchContract, auth, db, setup, skip } from "./game-test-helpers";

after(async () => {
  await closeTestDb();
});
afterEach(async () => {
  await assertStoredNoticesMatchContract();
});
beforeEach(async () => {
  if (db) await resetDb(db);
});

let clock = new Date("2026-03-10T08:00:00+05:30");
const a = () => app({ now: () => clock });

interface P {
  token: string;
  id: string;
  name: string;
  codename: string;
}
async function mk(name: string, identity: "anonymous" | "semi-public" | "public" = "public"): Promise<P> {
  const { token, id } = await setup(a(), { email: `${name}@example.com`, username: name });
  if (identity !== "anonymous") {
    assert.equal((await request(a()).patch("/api/profile").set(auth(token)).send({ identitySetting: identity })).status, 200);
  }
  const [p] = await db!.select().from(profiles).where(eq(profiles.userId, id));
  return { token, id, name, codename: p!.publicCodename };
}
const invite = (from: P, username: string) => request(a()).post("/api/duo/invite").set(auth(from.token)).send({ username });
const respond = (who: P, id: string, verb: "accept" | "decline") => request(a()).post(`/api/duo/invites/${id}/${verb}`).set(auth(who.token));
const checkin = (who: P, kind: string) => request(a()).post("/api/duo/checkin").set(auth(who.token)).send({ kind });
const leave = (who: P) => request(a()).post("/api/duo/leave").set(auth(who.token));
async function view(who: P) {
  const res = await request(a()).get("/api/duo").set(auth(who.token));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return assertContract(DuoResponseSchema, res.body);
}
/** x and y form a duo (x invites by y's public username; y accepts). */
async function formed(x: P, y: P) {
  const inv = await invite(x, y.name);
  assert.equal(inv.status, 201, JSON.stringify(inv.body));
  const acc = await respond(y, inv.body.id, "accept");
  assert.equal(acc.status, 200, JSON.stringify(acc.body));
}
const noticesOf = (id: string, kind: string) => db!.select().from(notices).where(and(eq(notices.userId, id), eq(notices.kind, kind)));
const scoresOf = async (id: string) =>
  (await db!.select().from(domainScores).where(eq(domainScores.userId, id))).map((s) => [s.domain, s.score]).sort();

test("invite -> accept forms a duo; partners see each other by username, never scores", { skip }, async () => {
  const x = await mk("xena_1", "semi-public");
  const y = await mk("yuri_1");
  const inv = await invite(x, y.name);
  assert.equal(inv.status, 201, JSON.stringify(inv.body));
  assertContract(DuoInviteResponseSchema, inv.body);
  assert.equal((await view(x)).partner, null);
  // Before the duo exists the invitee sees the inviter as a stranger would (semi-public: the codename).
  const pending = (await view(y)).pendingInvites;
  assert.deepEqual(pending.map((p) => [p.direction, p.handle, p.isCodename]), [["incoming", x.codename, true]]);
  assert.deepEqual((await view(x)).pendingInvites.map((p) => [p.direction, p.handle]), [["outgoing", "yuri_1"]]);

  assert.equal((await respond(y, inv.body.id, "accept")).status, 200);
  const vx = await view(x);
  const vy = await view(y);
  assert.equal(vx.partner?.handle, "yuri_1");
  assert.equal(vy.partner?.handle, "xena_1", "inside a duo both see usernames");
  assert.equal(vx.partner?.scores, undefined);
  assert.equal(vy.partner?.scores, undefined);
  assert.deepEqual([vx.pendingInvites, vy.pendingInvites], [[], []]);
  const text = JSON.stringify([vx, vy]);
  assert.ok(!text.includes(x.id) && !text.includes(y.id) && !/hidden|userId/i.test(text));
  assert.equal((await db!.select().from(duos)).length, 1);
  assert.equal((await db!.select().from(duoMembers)).length, 2);
  assert.equal((await db!.select().from(duoInvites).where(eq(duoInvites.id, inv.body.id)))[0]!.status, "accepted");
});

test("one duo per user: inviting into or from a duo -> 409 already_in_duo; other open invites are cancelled", { skip }, async () => {
  const x = await mk("xena_1");
  const y = await mk("yuri_1");
  const z = await mk("zed_1");
  const w = await mk("wren_1");
  const early = await invite(z, x.name); // pending before x forms a duo
  await formed(x, y);
  assert.equal((await respond(x, early.body.id, "accept")).status, 409, "the early invite was cancelled when x joined a duo");
  const r1 = await invite(z, x.name);
  assert.deepEqual([r1.status, r1.body.code, r1.body.error], [409, "unavailable", "That operator can't take a partner right now."]);
  const r2 = await invite(x, w.name);
  assert.deepEqual([r2.status, r2.body.code], [409, "already_in_duo"]);
  assert.equal((await db!.select().from(duos)).length, 1);
});

test("two invites to one user: only one accept wins; crossing accepts never give a user two duos", { skip }, async () => {
  const x = await mk("xena_1");
  const y = await mk("yuri_1");
  const z = await mk("zed_1");
  const i1 = await invite(x, y.name);
  const i2 = await invite(z, y.name);
  const both = await Promise.all([respond(y, i1.body.id, "accept"), respond(y, i2.body.id, "accept")]);
  assert.deepEqual(both.map((r) => r.status).sort(), [200, 409]);
  assert.equal((await db!.select().from(duoMembers).where(eq(duoMembers.userId, y.id))).length, 1);

  // x accepts z's invite while y accepts x's: x would be in two duos; the primary key allows one.
  await resetDb(db!);
  const x2 = await mk("xena_1");
  const y2 = await mk("yuri_1");
  const z2 = await mk("zed_1");
  const ix = await invite(z2, x2.name);
  const iy = await invite(x2, y2.name);
  const crossed = await Promise.all([respond(x2, ix.body.id, "accept"), respond(y2, iy.body.id, "accept")]);
  assert.equal(crossed.filter((r) => r.status === 200).length, 1, JSON.stringify(crossed.map((r) => [r.status, r.body])));
  assert.equal((await db!.select().from(duoMembers).where(eq(duoMembers.userId, x2.id))).length, 1);
  assert.equal((await db!.select().from(duos)).length, 1);
});

test("invites resolve handles like follow: public username or any codename; a semi-public username does not resolve", { skip }, async () => {
  const x = await mk("xena_1");
  const semi = await mk("sam_1", "semi-public");
  const anon = await mk("ana_1", "anonymous");
  assert.equal((await invite(x, "sam_1")).status, 404, "a semi-public username is not resolvable");
  assert.equal((await invite(x, "ana_1")).status, 404);
  assert.equal((await invite(x, "nobody_1")).status, 404);
  assert.equal((await invite(x, x.name)).status, 400);
  assert.equal((await invite(x, semi.codename)).status, 201);
  assert.equal((await invite(x, anon.codename.toLowerCase())).status, 201);
  assert.equal((await invite(x, semi.codename)).status, 409, "an invite to the same player is already open");
});

test("blocked users cannot invite either way, and the answer matches an unknown handle", { skip }, async () => {
  const x = await mk("xena_1");
  const y = await mk("yuri_1");
  await db!.insert(blocks).values({ blockerId: y.id, blockedId: x.id });
  const r1 = await invite(x, y.name);
  const r2 = await invite(y, x.name);
  assert.deepEqual([r1.status, r1.body.code], [404, "not_found"]);
  assert.deepEqual([r2.status, r2.body.code], [404, "not_found"]);
  assert.equal((await db!.select().from(duoInvites)).length, 0);
});

test("blocking the partner dissolves the duo; a block after an invite stops its acceptance", { skip }, async () => {
  const x = await mk("xena_1");
  const y = await mk("yuri_1");
  const z = await mk("zed_1");
  await formed(x, y);
  assert.equal((await request(a()).post(`/api/social/block/${y.name}`).set(auth(x.token))).status, 204);
  assert.equal((await view(x)).partner, null);
  assert.equal((await view(y)).partner, null);
  const inv = await invite(z, x.name);
  await db!.insert(blocks).values({ blockerId: x.id, blockedId: z.id });
  assert.equal((await respond(x, inv.body.id, "accept")).status, 409);
  assert.equal((await db!.select().from(duoMembers)).length, 0);
});

test("decline by the invitee; only the invitee may answer", { skip }, async () => {
  const x = await mk("xena_1");
  const y = await mk("yuri_1");
  const inv = await invite(x, y.name);
  assert.equal((await respond(x, inv.body.id, "accept")).status, 404, "the inviter cannot accept");
  assert.equal((await respond(x, inv.body.id, "decline")).status, 404);
  assert.equal((await respond(y, "not-a-uuid", "accept")).status, 404);
  assert.equal((await respond(y, inv.body.id, "decline")).status, 200);
  assert.equal((await respond(y, inv.body.id, "accept")).status, 409, "already answered");
  assert.equal((await view(y)).pendingInvites.length, 0);
  assert.equal((await db!.select().from(duos)).length, 0);
});

test("check-ins: both see them for 7 days with timestamps; the partner gets a duo_checkin notice", { skip }, async () => {
  const x = await mk("xena_1");
  const y = await mk("yuri_1");
  assert.equal((await checkin(x, "going_now")).status, 404, "no duo yet");
  await formed(x, y);
  const duoId = (await db!.select().from(duos))[0]!.id;
  await db!.insert(duoCheckins).values({ duoId, userId: y.id, kind: "done", createdAt: new Date(clock.getTime() - 8 * 86_400_000) });
  const res = await checkin(x, "checked_in");
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assertContract(DuoCheckinResponseSchema, res.body);
  assert.equal((await checkin(y, "done")).status, 201);
  assert.equal((await checkin(y, "bogus")).status, 400);
  const vx = await view(x);
  assert.deepEqual(vx.checkins.map((c) => [c.kind, c.fromMe]).sort(), [["checked_in", true], ["done", false]]);
  assert.ok(vx.checkins.every((c) => !Number.isNaN(Date.parse(c.createdAt))));
  const ny = await noticesOf(y.id, "duo_checkin");
  assert.deepEqual(ny.map((n) => n.payload), [{ handle: "xena_1", kind: "checked_in" }]);
  assert.equal((await noticesOf(x.id, "duo_checkin")).length, 1);
  // The kinds filter: a client that does not render duo_checkin never receives it.
  const some = await request(a()).get("/api/notices?kinds=achievement").set(auth(y.token));
  assert.deepEqual(some.body.items, []);
  const withKind = await request(a()).get("/api/notices?kinds=duo_checkin").set(auth(y.token));
  assert.equal(withKind.body.items.length, 1);
});

test("a nudge (going_now) is limited to 3 per local day per sender: the 4th -> 429 nudge_limit; the next day resets", { skip }, async () => {
  const x = await mk("xena_1");
  const y = await mk("yuri_1");
  await formed(x, y);
  clock = new Date("2026-03-10T09:00:00+05:30");
  for (let i = 0; i < 3; i++) assert.equal((await checkin(x, "going_now")).status, 201);
  const fourth = await checkin(x, "going_now");
  assert.equal(fourth.status, 429);
  assert.equal(fourth.body.code, "nudge_limit");
  assert.equal((await checkin(y, "going_now")).status, 201, "the limit is per sender");
  assert.equal((await checkin(x, "checked_in")).status, 201, "other kinds are not nudges");
  assert.equal((await noticesOf(y.id, "duo_checkin")).filter((n) => (n.payload as { kind: string }).kind === "going_now").length, 3);
  clock = new Date("2026-03-11T00:30:00+05:30");
  assert.equal((await checkin(x, "going_now")).status, 201, "a new local day");
  // 23:50 and 00:10 local are different days even a few minutes apart.
  clock = new Date("2026-03-11T23:50:00+05:30");
  for (let i = 0; i < 2; i++) assert.equal((await checkin(x, "going_now")).status, 201);
  assert.equal((await checkin(x, "going_now")).status, 429);
  clock = new Date("2026-03-12T00:10:00+05:30");
  assert.equal((await checkin(x, "going_now")).status, 201);
});

test("every check-in kind is capped at 10 per sender per local day -> 429 checkin_limit; the next local day resets", { skip }, async () => {
  const x = await mk("xena_1");
  const y = await mk("yuri_1");
  await formed(x, y);
  clock = new Date("2026-03-10T09:00:00+05:30");
  for (let i = 0; i < 3; i++) assert.equal((await checkin(x, "going_now")).status, 201);
  for (let i = 0; i < 7; i++) assert.equal((await checkin(x, i % 2 ? "done" : "checked_in")).status, 201);
  const over = await checkin(x, "checked_in");
  assert.deepEqual([over.status, over.body.code], [429, "checkin_limit"]);
  assert.equal((await checkin(y, "done")).status, 201, "the cap is per sender");
  clock = new Date("2026-03-10T23:59:00+05:30");
  assert.equal((await checkin(x, "done")).status, 429);
  clock = new Date("2026-03-11T00:01:00+05:30");
  assert.equal((await checkin(x, "done")).status, 201, "a new local day");
  assert.equal((await noticesOf(y.id, "duo_checkin")).length, 11);
});

test("check-ins and the whole duo never create score_events or change scores", { skip }, async () => {
  const x = await mk("xena_1");
  const y = await mk("yuri_1");
  const events = async () => (await db!.select({ n: count() }).from(scoreEvents))[0]!.n;
  const before = [await events(), await scoresOf(x.id), await scoresOf(y.id)];
  await formed(x, y);
  for (const k of ["going_now", "checked_in", "done"]) assert.equal((await checkin(x, k)).status, 201);
  await checkin(y, "done");
  await leave(y);
  assert.deepEqual([await events(), await scoresOf(x.id), await scoresOf(y.id)], before);
});

test("leave dissolves the duo for both, drops its check-ins, and both may pair again", { skip }, async () => {
  const x = await mk("xena_1");
  const y = await mk("yuri_1");
  const z = await mk("zed_1");
  assert.equal((await leave(x)).status, 404, "not in a duo");
  await formed(x, y);
  await checkin(x, "done");
  assert.equal((await leave(y)).status, 204);
  assert.deepEqual([(await view(x)).partner, (await view(y)).partner], [null, null]);
  assert.equal((await db!.select().from(duoCheckins)).length, 0);
  assert.equal((await db!.select().from(duoMembers)).length, 0);
  await formed(x, z);
  assert.equal((await view(x)).partner?.handle, "zed_1");
});

test("deleting an account removes its duo", { skip }, async () => {
  const x = await mk("xena_1");
  const y = await mk("yuri_1");
  await formed(x, y);
  await db!.delete(users).where(eq(users.id, y.id));
  assert.equal((await view(x)).partner, null);
  assert.equal((await db!.select().from(duos)).length, 0);
});
