import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { eq } from "drizzle-orm";
import { closeTestDb, resetDb } from "@workspace/db/testing";
import { blocks, follows, profiles, userReports } from "@workspace/db";
import { USER_CODENAME_RE } from "@workspace/engine";
import {
  FollowersCountResponseSchema,
  GameStateSchema,
  PublicProfileListSchema,
  SocialProfileResponseSchema,
  UserReportResponseSchema,
} from "@workspace/contracts";
import { freePublicCodename } from "../services/social";
import { app, assertContract, auth, db, setup, skip } from "./game-test-helpers";

after(async () => {
  await closeTestDb();
});
beforeEach(async () => {
  if (db) await resetDb(db);
});

type A = ReturnType<typeof app>;
type Identity = "anonymous" | "semi-public" | "public";

/** A registered, onboarded user whose identity setting is `identity`. */
async function mk(a: A, name: string, identity: Identity) {
  const { token, id } = await setup(a, { email: `${name}@example.com`, username: name });
  const patch = await request(a).patch("/api/profile").set(auth(token)).send({ identitySetting: identity });
  assert.equal(patch.status, 200);
  const [p] = await db!.select().from(profiles).where(eq(profiles.userId, id));
  return { token, id, name, codename: p!.publicCodename };
}

const enc = encodeURIComponent;
const handles = (body: unknown) => (body as { handle: string }[]).map((p) => p.handle);

/** No hidden-like or identifier key at any depth, and none of the forbidden strings anywhere in the payload. */
function deepScan(body: unknown, forbidden: string[]) {
  const walk = (v: unknown, path: string) => {
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
    else if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) {
        assert.ok(!/hidden/i.test(k), `hidden-like key at ${path}.${k}`);
        assert.ok(!/^(userId|email)$/.test(k), `identifier key at ${path}.${k}`);
        walk(x, `${path}.${k}`);
      }
    }
  };
  walk(body, "$");
  const text = JSON.stringify(body);
  for (const f of forbidden) assert.ok(!text.includes(f), `payload leaks ${f}`);
}

test("onboarding assigns a unique public codename (USER // WORD-N)", { skip }, async () => {
  const a = app();
  const three = [await mk(a, "alpha_1", "public"), await mk(a, "bravo_1", "public"), await mk(a, "charlie_1", "public")];
  for (const u of three) assert.match(u.codename, USER_CODENAME_RE);
  assert.equal(new Set(three.map((u) => u.codename)).size, 3);
});

test("freePublicCodename retries past a taken codename", { skip }, async () => {
  const a = app();
  const u = await mk(a, "alpha_1", "public");
  await db!.update(profiles).set({ publicCodename: "USER // ANCHOR-1" }).where(eq(profiles.userId, u.id));
  // rng 0 draws USER // ANCHOR-1 (taken); the next draws differ
  const draws = [0, 0, 0.5, 0.5];
  let i = 0;
  const next = await freePublicCodename(db!, () => draws[Math.min(i++, draws.length - 1)]!);
  assert.notEqual(next, "USER // ANCHOR-1");
  assert.match(next, USER_CODENAME_RE);
});

test("search requires 3+ chars and a session", { skip }, async () => {
  const a = app();
  const me = await mk(a, "me_1", "public");
  assert.equal((await request(a).get("/api/social/search?q=ab").set(auth(me.token))).status, 400);
  assert.equal((await request(a).get("/api/social/search").set(auth(me.token))).status, 400);
  assert.equal((await request(a).get("/api/social/search?q=abc")).status, 401);
});

test("search: public users by username prefix, semi-public only by codename word, anonymous never", { skip }, async () => {
  const a = app();
  const me = await mk(a, "me_1", "public");
  await mk(a, "pubby_1", "public");
  const semi = await mk(a, "pubsemi_1", "semi-public");
  const anon = await mk(a, "pubanon_1", "anonymous");
  const search = async (q: string) => (await request(a).get(`/api/social/search?q=${encodeURIComponent(q)}`).set(auth(me.token))).body;

  const res = await request(a).get("/api/social/search?q=pub").set(auth(me.token));
  assert.equal(res.status, 200);
  const list = assertContract(PublicProfileListSchema, res.body);
  assert.deepEqual(list.map((p) => p.handle), ["pubby_1"]);
  assert.equal(list[0]!.isCodename, false);
  assert.equal("scores" in list[0]!, false);
  deepScan(res.body, [anon.name, anon.codename, "pubsemi_1", semi.codename]);

  // a semi-public username (full, or a prefix) says nothing about them
  assert.deepEqual(await search("pubsemi_1"), []);
  assert.deepEqual(await search("pubsemi"), []);
  assert.deepEqual(await search("pubanon_1"), []);

  // the codename word prefix finds them, projected as a codename; the fixed USER prefix matches nobody
  const word = semi.codename.slice("USER // ".length); // e.g. BOLT-3
  for (const q of [word.slice(0, 3), word.toLowerCase(), word]) {
    const hit = await search(q);
    assert.ok(hit.some((p: { handle: string }) => p.handle === semi.codename), `codename word ${q} finds the semi-public user`);
    for (const p of hit) assert.equal(p.isCodename, true);
    deepScan(hit, ["pubsemi_1", anon.name]);
  }
  assert.deepEqual(await search("USE"), []);
  assert.deepEqual(await search("USER"), []);
  assert.deepEqual(await search("user //"), []);
  // never the anonymous user's codename word
  const anonWord = anon.codename.slice("USER // ".length);
  assert.ok(!(await search(anonWord)).some((p: { handle: string }) => p.handle === anon.codename));
});

test("search orders codename hits by codename, never by the hidden username", { skip }, async () => {
  const a = app();
  const me = await mk(a, "me_1", "public");
  // usernames sort the opposite way to the codenames we force
  const x = await mk(a, "aaa_first", "semi-public");
  const y = await mk(a, "zzz_last", "semi-public");
  await db!.update(profiles).set({ publicCodename: "USER // ZETA-1" }).where(eq(profiles.userId, x.id));
  await db!.update(profiles).set({ publicCodename: "USER // ZEST-1" }).where(eq(profiles.userId, y.id));
  const r = await request(a).get("/api/social/search?q=zes").set(auth(me.token));
  assert.deepEqual(handles(r.body), ["USER // ZEST-1"]);
  const r2 = await request(a).get("/api/social/search?q=zet").set(auth(me.token));
  assert.deepEqual(handles(r2.body), ["USER // ZETA-1"]);
  await db!.update(profiles).set({ publicCodename: "USER // ZETB-1" }).where(eq(profiles.userId, y.id));
  const both = await request(a).get("/api/social/search?q=zet").set(auth(me.token));
  assert.deepEqual(handles(both.body), ["USER // ZETA-1", "USER // ZETB-1"]);
  // swap the codenames: the order follows the codenames, not the usernames
  await db!.update(profiles).set({ publicCodename: "USER // ZETC-1" }).where(eq(profiles.userId, x.id));
  const swapped = await request(a).get("/api/social/search?q=zet").set(auth(me.token));
  assert.deepEqual(handles(swapped.body), ["USER // ZETB-1", "USER // ZETC-1"]);
});

test("search excludes self, treats wildcard characters literally, and hides blocked users both ways", { skip }, async () => {
  const a = app();
  const me = await mk(a, "zed_me", "public");
  const other = await mk(a, "zed_other", "public");
  await mk(a, "zed_third", "public");
  const r1 = await request(a).get("/api/social/search?q=zed").set(auth(me.token));
  assert.deepEqual(handles(r1.body).sort(), ["zed_other", "zed_third"]);
  assert.deepEqual((await request(a).get("/api/social/search?q=%25%25%25").set(auth(me.token))).body, []);
  assert.deepEqual((await request(a).get("/api/social/search?q=z_d").set(auth(me.token))).body, []);

  assert.equal((await request(a).post(`/api/social/block/${other.name}`).set(auth(me.token))).status, 204);
  assert.deepEqual(handles((await request(a).get("/api/social/search?q=zed").set(auth(me.token))).body), ["zed_third"]);
  // the blocked user does not find the blocker either
  assert.deepEqual(handles((await request(a).get("/api/social/search?q=zed").set(auth(other.token))).body), ["zed_third"]);
});

test("follow: public by username, semi-public by codename; unfollow; following list; follower count", { skip }, async () => {
  const a = app();
  const me = await mk(a, "me_1", "semi-public");
  const pub = await mk(a, "pubby_1", "public");
  const semi = await mk(a, "semmy_1", "semi-public");

  assert.equal((await request(a).post(`/api/social/follow/${pub.name}`).set(auth(me.token))).status, 204);
  assert.equal((await request(a).post(`/api/social/follow/${enc(semi.codename)}`).set(auth(me.token))).status, 204);
  assert.equal((await request(a).post(`/api/social/follow/${pub.name}`).set(auth(me.token))).status, 204); // repeat: no-op

  const list = await request(a).get("/api/social/following").set(auth(me.token));
  assert.equal(list.status, 200);
  const out = assertContract(PublicProfileListSchema, list.body);
  assert.deepEqual(out.map((p) => p.handle).sort(), [pub.name, semi.codename].sort());
  for (const p of out) assert.deepEqual(Object.keys(p).sort(), ["handle", "isCodename", "rank", "shadowActive", "trajectory"]);
  deepScan(list.body, [semi.name]);

  const cnt = await request(a).get("/api/social/followers/count").set(auth(pub.token));
  assert.deepEqual(assertContract(FollowersCountResponseSchema, cnt.body), { count: 1 });
  assert.equal((await request(a).get("/api/social/followers/count").set(auth(me.token))).body.count, 0);

  assert.equal((await request(a).delete(`/api/social/follow/${pub.name}`).set(auth(me.token))).status, 204);
  assert.equal((await request(a).delete(`/api/social/follow/${pub.name}`).set(auth(me.token))).status, 204);
  assert.deepEqual(handles((await request(a).get("/api/social/following").set(auth(me.token))).body), [semi.codename]);
});

test("only public and semi-public users can be followed; non-public usernames do not resolve", { skip }, async () => {
  const a = app();
  const me = await mk(a, "me_1", "public");
  const semi = await mk(a, "semmy_1", "semi-public");
  const anon = await mk(a, "anony_1", "anonymous");

  assert.equal((await request(a).post(`/api/social/follow/${anon.name}`).set(auth(me.token))).status, 404);
  assert.equal((await request(a).post(`/api/social/follow/${enc(anon.codename)}`).set(auth(me.token))).status, 404);
  assert.equal((await request(a).post(`/api/social/follow/${semi.name}`).set(auth(me.token))).status, 404);
  assert.equal((await request(a).post("/api/social/follow/nobody_here").set(auth(me.token))).status, 404);
  assert.equal((await request(a).post(`/api/social/follow/${me.name}`).set(auth(me.token))).status, 400);
  const r = await request(a).post(`/api/social/follow/${anon.name}`).set(auth(me.token));
  deepScan(r.body, [anon.name]);
  assert.equal((await db!.select().from(follows)).length, 0);
});

test("follow a blocked user -> 404 like an unknown player (either direction); blocking removes follows; unblock restores", { skip }, async () => {
  const a = app();
  const me = await mk(a, "me_1", "public");
  const pub = await mk(a, "pubby_1", "public");
  assert.equal((await request(a).post(`/api/social/follow/${pub.name}`).set(auth(me.token))).status, 204);
  assert.equal((await request(a).post(`/api/social/follow/${me.name}`).set(auth(pub.token))).status, 204);

  assert.equal((await request(a).post(`/api/social/block/${pub.name}`).set(auth(me.token))).status, 204);
  assert.equal((await db!.select().from(follows)).length, 0);
  assert.equal((await db!.select().from(blocks)).length, 1);

  const f1 = await request(a).post(`/api/social/follow/${pub.name}`).set(auth(me.token));
  assert.equal(f1.status, 404);
  assert.equal(f1.body.code, "not_found");
  assert.equal((await request(a).post(`/api/social/follow/${me.name}`).set(auth(pub.token))).status, 404);
  assert.equal((await request(a).get(`/api/social/profile/${pub.name}`).set(auth(me.token))).status, 404);

  assert.equal((await request(a).delete(`/api/social/block/${pub.name}`).set(auth(me.token))).status, 204);
  assert.equal((await request(a).post(`/api/social/follow/${pub.name}`).set(auth(me.token))).status, 204);
});

test("block resolves an anonymous user by codename only; cannot block self or an unknown user", { skip }, async () => {
  const a = app();
  const me = await mk(a, "me_1", "public");
  const anon = await mk(a, "anony_1", "anonymous");
  assert.equal((await request(a).post(`/api/social/block/${anon.name}`).set(auth(me.token))).status, 404);
  assert.equal((await request(a).post(`/api/social/block/${enc(anon.codename)}`).set(auth(me.token))).status, 204);
  assert.equal((await request(a).post(`/api/social/block/${enc(anon.codename)}`).set(auth(me.token))).status, 204);
  assert.equal((await db!.select().from(blocks)).length, 1);
  assert.equal((await request(a).post(`/api/social/block/${me.name}`).set(auth(me.token))).status, 400);
  assert.equal((await request(a).post("/api/social/block/ghost_nobody").set(auth(me.token))).status, 404);
  assert.equal((await request(a).delete(`/api/social/block/${enc(anon.codename)}`).set(auth(me.token))).status, 204);
  assert.equal((await db!.select().from(blocks)).length, 0);
});

test("profile view: a follower sees rank/trajectory/shadow only; non-public usernames never appear", { skip }, async () => {
  const a = app();
  const me = await mk(a, "me_1", "public");
  const semi = await mk(a, "semmy_1", "semi-public");
  const anon = await mk(a, "anony_1", "anonymous");

  const before = await request(a).get(`/api/social/profile/${enc(semi.codename)}`).set(auth(me.token));
  assert.equal(before.status, 200);
  const view = assertContract(SocialProfileResponseSchema, before.body);
  assert.equal(view.following, false);
  assert.equal(view.isSelf, false);
  assert.equal(view.profile.handle, semi.codename);
  assert.equal("scores" in view.profile, false);
  deepScan(before.body, [semi.name]);

  await request(a).post(`/api/social/follow/${enc(semi.codename)}`).set(auth(me.token));
  const after = await request(a).get(`/api/social/profile/${enc(semi.codename)}`).set(auth(me.token));
  assert.equal(after.body.following, true);
  assert.deepEqual(Object.keys(after.body.profile).sort(), ["handle", "isCodename", "rank", "shadowActive", "trajectory"]);

  assert.equal((await request(a).get(`/api/social/profile/${enc(anon.codename)}`).set(auth(me.token))).status, 404);
  const own = await request(a).get(`/api/social/profile/${me.name}`).set(auth(me.token));
  assert.equal(own.status, 200);
  assert.equal(own.body.isSelf, true);
  assert.equal(own.body.following, false);
  assert.ok(own.body.profile.scores);
  deepScan(own.body, []);
});

test("a followed user who later goes anonymous is shown by codename only", { skip }, async () => {
  const a = app();
  const me = await mk(a, "me_1", "public");
  const pub = await mk(a, "pubby_1", "public");
  await request(a).post(`/api/social/follow/${pub.name}`).set(auth(me.token));
  assert.deepEqual(handles((await request(a).get("/api/social/following").set(auth(me.token))).body), ["pubby_1"]);
  await request(a).patch("/api/profile").set(auth(pub.token)).send({ identitySetting: "anonymous" });
  const list = await request(a).get("/api/social/following").set(auth(me.token));
  assert.equal(list.body[0].handle, pub.codename);
  assert.equal(list.body[0].isCodename, true);
  deepScan(list.body, ["pubby_1"]);
  const view = await request(a).get(`/api/social/profile/${enc(pub.codename)}`).set(auth(me.token));
  assert.equal(view.status, 200);
  assert.equal(view.body.following, true);
});

test("report: 201, stored for review; validates reason and subject", { skip }, async () => {
  const a = app();
  const me = await mk(a, "me_1", "public");
  const pub = await mk(a, "pubby_1", "public");
  const anon = await mk(a, "anony_1", "anonymous");
  const report = (body: object) => request(a).post("/api/social/report").set(auth(me.token)).send(body);

  const ok = await report({ subject: pub.name, reason: "Abusive taunts" });
  assert.equal(ok.status, 201);
  assertContract(UserReportResponseSchema, ok.body);
  const rows = await db!.select().from(userReports);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.reporterId, me.id);
  assert.equal(rows[0]!.subjectId, pub.id);
  assert.equal(rows[0]!.reason, "Abusive taunts");
  assert.equal(rows[0]!.resolvedAt, null);

  assert.equal((await report({ subject: anon.codename, reason: "Spam" })).status, 201);
  assert.equal((await report({ subject: pub.name, reason: "x".repeat(501) })).status, 400);
  assert.equal((await report({ subject: pub.name, reason: "  " })).status, 400);
  assert.equal((await report({ subject: me.name, reason: "self" })).status, 400);
  assert.equal((await report({ subject: anon.name, reason: "x" })).status, 404);
  assert.equal((await request(a).post("/api/social/report").send({ subject: pub.name, reason: "x" })).status, 401);
  assert.equal((await db!.select().from(userReports)).length, 2);
});

test("report: one open report per reporter and subject (409 already_reported); resolved ones can be re-filed", { skip }, async () => {
  const a = app();
  const me = await mk(a, "me_1", "public");
  const pub = await mk(a, "pubby_1", "public");
  const report = (reason: string) => request(a).post("/api/social/report").set(auth(me.token)).send({ subject: pub.name, reason });
  assert.equal((await report("one")).status, 201);
  const dup = await report("two");
  assert.equal(dup.status, 409);
  assert.equal(dup.body.code, "already_reported");
  assert.equal((await db!.select().from(userReports)).length, 1);
  await db!.update(userReports).set({ resolvedAt: new Date() });
  assert.equal((await report("three")).status, 201);
});

test("report: at most 10 per reporter per local day (429 report_limit), the next day is free", { skip }, async () => {
  let now = new Date("2026-06-08T06:30:00Z"); // 12:00 in Asia/Kolkata
  const a = app({ now: () => now });
  const me = await mk(a, "me_1", "public");
  const targets = [];
  for (let i = 0; i < 11; i++) targets.push(await mk(app(), `tgt_${i}`, "public")); // a fresh app each: the register limiter is per app
  const report = (name: string) => request(a).post("/api/social/report").set(auth(me.token)).send({ subject: name, reason: "spam" });
  for (let i = 0; i < 10; i++) assert.equal((await report(targets[i]!.name)).status, 201, `report ${i}`);
  const over = await report(targets[10]!.name);
  assert.equal(over.status, 429);
  assert.equal(over.body.code, "report_limit");
  assert.equal((await db!.select().from(userReports)).length, 10);
  // reports are stamped by the real clock; age them into the previous local day, then the injected clock moves on
  await db!.update(userReports).set({ createdAt: new Date(now.getTime() - 86_400_000) });
  assert.equal((await report(targets[10]!.name)).status, 201);
});

test("GameState.profile carries the viewer's own public codename", { skip }, async () => {
  const a = app();
  const me = await mk(a, "me_1", "semi-public");
  const state = assertContract(GameStateSchema, (await request(a).get("/api/state").set(auth(me.token))).body);
  assert.equal(state.profile.publicCodename, me.codename);
});

test("block and report by an anonymous user's codename keep working (a codename is not linked to identity)", { skip }, async () => {
  const a = app();
  const me = await mk(a, "me_1", "public");
  const anon = await mk(a, "anony_1", "anonymous");
  assert.equal((await request(a).post(`/api/social/block/${enc(anon.codename)}`).set(auth(me.token))).status, 204);
  assert.equal((await request(a).post("/api/social/report").set(auth(me.token)).send({ subject: anon.codename, reason: "x" })).status, 201);
});

test("following list excludes players blocked in either direction (follow/block race)", { skip }, async () => {
  const a = app();
  const me = await mk(a, "me_1", "public");
  const p1 = await mk(a, "pubby_1", "public");
  const p2 = await mk(a, "pubby_2", "public");
  await request(a).post(`/api/social/follow/${p1.name}`).set(auth(me.token));
  await request(a).post(`/api/social/follow/${p2.name}`).set(auth(me.token));
  // simulate the race: block rows exist while the follow rows survived
  await db!.insert(blocks).values({ blockerId: me.id, blockedId: p1.id });
  await db!.insert(blocks).values({ blockerId: p2.id, blockedId: me.id });
  assert.equal((await db!.select().from(follows)).length, 2);
  assert.deepEqual((await request(a).get("/api/social/following").set(auth(me.token))).body, []);
  // and they do not count as followers either
  assert.equal((await request(a).get("/api/social/followers/count").set(auth(p1.token))).body.count, 0);
});

test("mutations replay under the same Idempotency-Key", { skip }, async () => {
  const a = app();
  const me = await mk(a, "me_1", "public");
  const pub = await mk(a, "pubby_1", "public");
  const send = () =>
    request(a).post("/api/social/report").set(auth(me.token)).set("Idempotency-Key", "rep-1").send({ subject: pub.name, reason: "Spam" });
  const first = await send();
  const second = await send();
  assert.equal(first.status, 201);
  assert.equal(second.status, 200);
  assert.deepEqual(second.body, first.body);
  assert.equal((await db!.select().from(userReports)).length, 1);
});

test("deep scan: social responses never carry a hidden key or a non-public user's username", { skip }, async () => {
  const a = app();
  const me = await mk(a, "me_1", "public");
  const anon = await mk(a, "secretive_1", "anonymous");
  const semi = await mk(a, "secretsemi_1", "semi-public");
  const pub = await mk(a, "secretpub_1", "public");
  await request(a).post(`/api/social/follow/${pub.name}`).set(auth(me.token));
  await request(a).post(`/api/social/follow/${enc(semi.codename)}`).set(auth(me.token));
  const bodies = [
    (await request(a).get("/api/social/search?q=secret").set(auth(me.token))).body,
    (await request(a).get("/api/social/following").set(auth(me.token))).body,
    (await request(a).get("/api/social/followers/count").set(auth(me.token))).body,
    (await request(a).get(`/api/social/profile/${pub.name}`).set(auth(me.token))).body,
    (await request(a).get(`/api/social/profile/${enc(semi.codename)}`).set(auth(me.token))).body,
    (await request(a).post(`/api/social/follow/${anon.name}`).set(auth(me.token))).body,
    (await request(a).post("/api/social/block/nobody_x").set(auth(me.token))).body,
  ];
  for (const b of bodies) deepScan(b, [anon.name, semi.name, "hidden"]);
  assert.equal((bodies[0] as unknown[]).length, 1); // only the public user matches a username prefix
});
