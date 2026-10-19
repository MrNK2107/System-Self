import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { eq } from "drizzle-orm";
import { closeTestDb, resetDb } from "@workspace/db/testing";
import { pushTokens, notificationPrefs } from "@workspace/db";
import { NotificationPrefsSchema } from "@workspace/contracts";
import { app, assertContract, auth, db, setup, skip } from "./game-test-helpers";
import { deleteAccount } from "../services/account";
import { withUserLock } from "../services/user-lock";

after(async () => {
  await closeTestDb();
});
beforeEach(async () => {
  if (db) await resetDb(db);
});

const TOKEN = "ExponentPushToken[abc123_XYZ]";
const enc = encodeURIComponent(TOKEN);

test("push and prefs routes need a session", { skip }, async () => {
  const a = app();
  assert.equal((await request(a).post("/api/push/tokens").send({ token: TOKEN, platform: "ios" })).status, 401);
  assert.equal((await request(a).delete("/api/push/tokens").send({ token: TOKEN })).status, 401);
  assert.equal((await request(a).get("/api/notifications/prefs")).status, 401);
  assert.equal((await request(a).put("/api/notifications/prefs").send({ events: false })).status, 401);
});

test("registering a token is idempotent and a token moves to whoever is signed in", { skip }, async () => {
  const a = app();
  const alice = await setup(a);
  const bob = await setup(a, { email: "bob@example.com", username: "bob_1" });
  const reg = (t: string) => request(a).post("/api/push/tokens").set(auth(t)).send({ token: TOKEN, platform: "ios" });
  assert.equal((await reg(alice.token)).status, 204);
  const [first] = await db!.select().from(pushTokens);
  assert.equal(first!.userId, alice.id);
  // Backdate instead of sleeping: re-registering must move last_seen_at forward, whatever the clock resolution.
  const earlier = new Date(first!.lastSeenAt.getTime() - 60_000);
  await db!.update(pushTokens).set({ lastSeenAt: earlier });
  assert.equal((await reg(alice.token)).status, 204);
  const rows = await db!.select().from(pushTokens);
  assert.equal(rows.length, 1);
  assert.ok(rows[0]!.lastSeenAt.getTime() > earlier.getTime());
  assert.equal(rows[0]!.createdAt.getTime(), first!.createdAt.getTime());
  assert.equal((await reg(bob.token)).status, 204);
  const moved = await db!.select().from(pushTokens);
  assert.equal(moved.length, 1);
  assert.equal(moved[0]!.userId, bob.id);
});

test("registering validates the token shape and platform", { skip }, async () => {
  const a = app();
  const { token } = await setup(a);
  const post = (body: object) => request(a).post("/api/push/tokens").set(auth(token)).send(body);
  assert.equal((await post({ token: "not-a-token", platform: "ios" })).status, 400);
  assert.equal((await post({ token: TOKEN, platform: "web" })).status, 400);
  assert.equal((await post({ token: TOKEN })).status, 400);
  assert.equal((await db!.select().from(pushTokens)).length, 0);
});

test("deleting a token (in the JSON body) removes only the caller's own, and a repeat is a 204", { skip }, async () => {
  const a = app();
  const alice = await setup(a);
  const bob = await setup(a, { email: "bob@example.com", username: "bob_1" });
  await db!.insert(pushTokens).values({ userId: alice.id, token: TOKEN, platform: "android" });
  const del = (t: string, body: object = { token: TOKEN }) => request(a).delete("/api/push/tokens").set(auth(t)).send(body);
  assert.equal((await del(bob.token)).status, 204);
  assert.equal((await db!.select().from(pushTokens)).length, 1);
  assert.equal((await del(alice.token)).status, 204);
  assert.equal((await db!.select().from(pushTokens)).length, 0);
  assert.equal((await del(alice.token)).status, 204);
  assert.equal((await del(alice.token, { token: "nope" })).status, 204);
});

test("the old token-in-path DELETE route is gone (404), so tokens never land in URLs or access logs", { skip }, async () => {
  const a = app();
  const alice = await setup(a);
  await db!.insert(pushTokens).values({ userId: alice.id, token: TOKEN, platform: "android" });
  assert.equal((await request(a).delete(`/api/push/tokens/${enc}`).set(auth(alice.token))).status, 404);
  assert.equal((await db!.select().from(pushTokens)).length, 1);
});

test("token registration stamps the injected clock", { skip }, async () => {
  const at = new Date("2026-10-19T08:00:00Z");
  const a = app({ now: () => at });
  const { token } = await setup(a);
  assert.equal((await request(a).post("/api/push/tokens").set(auth(token)).send({ token: TOKEN, platform: "ios" })).status, 204);
  const [row] = await db!.select().from(pushTokens);
  assert.equal(row!.lastSeenAt.toISOString(), at.toISOString());
  assert.equal(row!.createdAt.toISOString(), at.toISOString());
});

test("prefs default to all on, update partially and persist", { skip }, async () => {
  const a = app();
  const { token, id } = await setup(a);
  const get = async () => assertContract(NotificationPrefsSchema, (await request(a).get("/api/notifications/prefs").set(auth(token))).body);
  assert.deepEqual(await get(), { morning: true, nightly: true, events: true });
  const put = await request(a).put("/api/notifications/prefs").set(auth(token)).send({ events: false });
  assert.equal(put.status, 200);
  assert.deepEqual(assertContract(NotificationPrefsSchema, put.body), { morning: true, nightly: true, events: false });
  await request(a).put("/api/notifications/prefs").set(auth(token)).send({ morning: false });
  assert.deepEqual(await get(), { morning: false, nightly: true, events: false });
  assert.equal((await request(a).put("/api/notifications/prefs").set(auth(token)).send({ events: "no" })).status, 400);
  assert.equal((await db!.select().from(notificationPrefs).where(eq(notificationPrefs.userId, id))).length, 1);
});

test("account deletion cascades to tokens and prefs", { skip }, async () => {
  const a = app();
  const { token, id } = await setup(a);
  await request(a).post("/api/push/tokens").set(auth(token)).send({ token: TOKEN, platform: "ios" });
  await request(a).put("/api/notifications/prefs").set(auth(token)).send({ events: false });
  await withUserLock(db!, id, (tx) => deleteAccount(tx, id));
  assert.equal((await db!.select().from(pushTokens)).length, 0);
  assert.equal((await db!.select().from(notificationPrefs)).length, 0);
});
