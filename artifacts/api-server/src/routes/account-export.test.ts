import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { eq, sql } from "drizzle-orm";
import { closeTestDb, resetDb } from "@workspace/db/testing";
import * as s from "@workspace/db/schema";
import { app, auth, db, setup, skip } from "./game-test-helpers";
import { NOW, WEEK, seedEverything } from "./export-fixtures";
import { EXPORT_TABLES } from "../services/export";
import { EXPORT_RATE_LIMIT_MAX } from "./account";
import { createApp } from "../app-factory";

after(async () => {
  await closeTestDb();
});
beforeEach(async () => {
  if (db) await resetDb(db);
});

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
