import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { and, eq, isNotNull } from "drizzle-orm";
import { closeTestDb, getTestDb, resetDb } from "@workspace/db/testing";
import { refreshTokens, users } from "@workspace/db";
import { createApp } from "../app-factory";
import type { Mailer } from "../lib/mailer";

const db = getTestDb();
const skip = db ? false : "TEST_DATABASE_URL not set";

const sent: Array<{ to: string; subject: string; text: string }> = [];
const mailer: Mailer = {
  async send(msg) {
    sent.push(msg);
  },
};
const lastCode = () => {
  const m = sent[sent.length - 1]?.text.match(/\b(\d{6})\b/);
  assert.ok(m, "expected a 6-digit code in the last email");
  return m[1]!;
};
const wrongCode = () => (lastCode() === "000000" ? "111111" : "000000");

after(async () => {
  await closeTestDb();
});

beforeEach(async () => {
  sent.length = 0;
  if (db) await resetDb(db);
});

const PASSWORD = "correct horse battery";
const NEW_PASSWORD = "a brand new password";
const validBody = (over: Record<string, unknown> = {}) => ({
  email: "Alice@Example.com",
  password: PASSWORD,
  username: "alice_1",
  birthYear: 1990,
  acceptTerms: true,
  ...over,
});

function app() {
  return createApp({ db, mailer });
}

test("register -> 201 with tokens and verify email sent", { skip }, async () => {
  const res = await request(app()).post("/api/auth/register").send(validBody());
  assert.equal(res.status, 201);
  assert.equal(res.body.user.email, "alice@example.com");
  assert.equal(res.body.user.username, "alice_1");
  assert.equal(res.body.user.role, "user");
  assert.equal(res.body.user.emailVerified, false);
  assert.equal(res.body.user.passwordHash, undefined);
  assert.equal(typeof res.body.accessToken, "string");
  assert.equal(typeof res.body.refreshToken, "string");
  assert.ok(!Number.isNaN(Date.parse(res.body.accessTokenExpiresAt)));
  assert.equal(sent.length, 1);
  assert.equal(sent[0]!.to, "alice@example.com");
  assert.match(sent[0]!.text, /\b\d{6}\b/);
});

test("register duplicate email (different case/whitespace) -> 409 email_taken", { skip }, async () => {
  const a = app();
  await request(a).post("/api/auth/register").send(validBody());
  const res = await request(a)
    .post("/api/auth/register")
    .send(validBody({ email: "  ALICE@example.COM ", username: "other_one" }));
  assert.equal(res.status, 409);
  assert.equal(res.body.code, "email_taken");
});

test("register duplicate username (case-insensitive) -> 409 username_taken", { skip }, async () => {
  const a = app();
  await request(a).post("/api/auth/register").send(validBody());
  const res = await request(a)
    .post("/api/auth/register")
    .send(validBody({ email: "b@example.com", username: "ALICE_1" }));
  assert.equal(res.status, 409);
  assert.equal(res.body.code, "username_taken");
});

test("register age 15 -> 400", { skip }, async () => {
  const res = await request(app())
    .post("/api/auth/register")
    .send(validBody({ birthYear: new Date().getFullYear() - 15 }));
  assert.equal(res.status, 400);
  assert.equal(typeof res.body.error, "string");
});

test("register age 16 -> 201", { skip }, async () => {
  const res = await request(app())
    .post("/api/auth/register")
    .send(validBody({ birthYear: new Date().getFullYear() - 16 }));
  assert.equal(res.status, 201);
});

test("register validation: short/long password, bad username, terms not accepted -> 400", { skip }, async () => {
  const a = app();
  for (const over of [
    { password: "short" },
    { password: "x".repeat(129) },
    { username: "no spaces" },
    { username: "ab" },
    { acceptTerms: false },
    { email: "not-an-email" },
  ]) {
    const res = await request(a).post("/api/auth/register").send(validBody(over));
    assert.equal(res.status, 400, JSON.stringify(over));
  }
});

test("login wrong password and unknown email return identical 401 bodies", { skip }, async () => {
  const a = app();
  await request(a).post("/api/auth/register").send(validBody());
  const wrong = await request(a).post("/api/auth/login").send({ email: "alice@example.com", password: "wrong password!!" });
  const unknown = await request(a).post("/api/auth/login").send({ email: "nobody@example.com", password: "wrong password!!" });
  assert.equal(wrong.status, 401);
  assert.equal(unknown.status, 401);
  assert.deepEqual(wrong.body, { error: "Invalid email or password" });
  assert.deepEqual(unknown.body, wrong.body);
  const ok = await request(a).post("/api/auth/login").send({ email: " ALICE@example.com", password: PASSWORD });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.user.username, "alice_1");
});

test("refresh rotates; a retry within 30s supersedes the lost token", { skip }, async () => {
  const a = app();
  const reg = await request(a).post("/api/auth/register").send(validBody());
  const rt1 = reg.body.refreshToken as string;
  const r2 = await request(a).post("/api/auth/refresh").send({ refreshToken: rt1 });
  assert.equal(r2.status, 200);
  const rt2 = r2.body.refreshToken as string;
  assert.notEqual(rt2, rt1);
  const retry = await request(a).post("/api/auth/refresh").send({ refreshToken: rt1 });
  assert.equal(retry.status, 200);
  assert.notEqual(retry.body.refreshToken, rt2);
  const lost = await request(a).post("/api/auth/refresh").send({ refreshToken: rt2 });
  assert.equal(lost.status, 401);
  assert.equal(lost.body.code, "invalid_refresh");
});

test("replaying a rotated refresh after 30s -> 401 and the family is revoked", { skip }, async () => {
  const a = app();
  const reg = await request(a).post("/api/auth/register").send(validBody());
  const rt1 = reg.body.refreshToken as string;
  const r2 = await request(a).post("/api/auth/refresh").send({ refreshToken: rt1 });
  assert.equal(r2.status, 200);
  await db!
    .update(refreshTokens)
    .set({ revokedAt: new Date(Date.now() - 31_000) })
    .where(and(eq(refreshTokens.userId, reg.body.user.id), isNotNull(refreshTokens.revokedAt)));
  const replay = await request(a).post("/api/auth/refresh").send({ refreshToken: rt1 });
  assert.equal(replay.status, 401);
  assert.equal(replay.body.code, "invalid_refresh");
  const after2 = await request(a).post("/api/auth/refresh").send({ refreshToken: r2.body.refreshToken });
  assert.equal(after2.status, 401);
});

test("logout revokes the refresh family", { skip }, async () => {
  const a = app();
  const reg = await request(a).post("/api/auth/register").send(validBody());
  const out = await request(a).post("/api/auth/logout").send({ refreshToken: reg.body.refreshToken });
  assert.equal(out.status, 204);
  const res = await request(a).post("/api/auth/refresh").send({ refreshToken: reg.body.refreshToken });
  assert.equal(res.status, 401);
});

test("forgot+reset with the mailed code; old access token then 401", { skip }, async () => {
  const a = app();
  const reg = await request(a).post("/api/auth/register").send(validBody());
  const forgot = await request(a).post("/api/auth/password/forgot").send({ email: "alice@example.com" });
  assert.equal(forgot.status, 204);
  assert.equal(sent.length, 2);
  const code = lastCode();
  const reset = await request(a)
    .post("/api/auth/password/reset")
    .send({ email: "alice@example.com", code, newPassword: NEW_PASSWORD });
  assert.equal(reset.status, 204);
  const me = await request(a).get("/api/auth/me").set("Authorization", `Bearer ${reg.body.accessToken}`);
  assert.equal(me.status, 401);
  const rf = await request(a).post("/api/auth/refresh").send({ refreshToken: reg.body.refreshToken });
  assert.equal(rf.status, 401);
  const login = await request(a).post("/api/auth/login").send({ email: "alice@example.com", password: NEW_PASSWORD });
  assert.equal(login.status, 200);
});

test("forgot for unknown email -> 204 and sends nothing; reset with wrong code -> 400", { skip }, async () => {
  const a = app();
  const forgot = await request(a).post("/api/auth/password/forgot").send({ email: "ghost@example.com" });
  assert.equal(forgot.status, 204);
  assert.equal(sent.length, 0);
  await request(a).post("/api/auth/register").send(validBody());
  await request(a).post("/api/auth/password/forgot").send({ email: "alice@example.com" });
  const bad = await request(a)
    .post("/api/auth/password/reset")
    .send({ email: "alice@example.com", code: wrongCode(), newPassword: NEW_PASSWORD });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.code, "invalid_code");
  const ghost = await request(a)
    .post("/api/auth/password/reset")
    .send({ email: "ghost@example.com", code: "123456", newPassword: NEW_PASSWORD });
  assert.equal(ghost.status, 400);
  assert.equal(ghost.body.code, "invalid_code");
});

test("email verify request + verify marks the user verified", { skip }, async () => {
  const a = app();
  const reg = await request(a).post("/api/auth/register").send(validBody());
  const auth = { Authorization: `Bearer ${reg.body.accessToken}` };
  const bad = await request(a).post("/api/auth/email/verify").set(auth).send({ code: wrongCode() });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.code, "invalid_code");
  const reqd = await request(a).post("/api/auth/email/verify/request").set(auth);
  assert.equal(reqd.status, 204);
  assert.equal(sent.length, 2);
  const ok = await request(a).post("/api/auth/email/verify").set(auth).send({ code: lastCode() });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.user.emailVerified, true);
});

test("email verify request: per-account cap -> 429 code_rate_limited", { skip }, async () => {
  const a = app();
  const reg = await request(a).post("/api/auth/register").send(validBody());
  const auth = { Authorization: `Bearer ${reg.body.accessToken}` };
  // Registration already created one verify code; 4 more fit in the hourly budget of 5.
  for (let i = 0; i < 4; i++) assert.equal((await request(a).post("/api/auth/email/verify/request").set(auth)).status, 204);
  const capped = await request(a).post("/api/auth/email/verify/request").set(auth);
  assert.equal(capped.status, 429);
  assert.equal(capped.body.code, "code_rate_limited");
  assert.equal(sent.length, 5);
});

test("password forgot: per-account cap still returns 204 but sends nothing", { skip }, async () => {
  const a = app();
  await request(a).post("/api/auth/register").send(validBody());
  for (let i = 0; i < 5; i++) {
    assert.equal((await request(a).post("/api/auth/password/forgot").send({ email: "alice@example.com" })).status, 204);
  }
  assert.equal(sent.length, 6);
  const capped = await request(a).post("/api/auth/password/forgot").send({ email: "alice@example.com" });
  assert.equal(capped.status, 204);
  assert.equal(sent.length, 6);
});

test("password change revokes other sessions and returns a fresh session", { skip }, async () => {
  const a = app();
  const reg = await request(a).post("/api/auth/register").send(validBody());
  const auth = { Authorization: `Bearer ${reg.body.accessToken}` };
  const wrong = await request(a)
    .post("/api/auth/password/change")
    .set(auth)
    .send({ currentPassword: "nope nope nope", newPassword: NEW_PASSWORD });
  assert.equal(wrong.status, 401);
  const ok = await request(a)
    .post("/api/auth/password/change")
    .set(auth)
    .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.user.id, reg.body.user.id);
  assert.equal(typeof ok.body.accessToken, "string");
  assert.equal(typeof ok.body.refreshToken, "string");
  // Other sessions are revoked...
  assert.equal((await request(a).get("/api/auth/me").set(auth)).status, 401);
  assert.equal((await request(a).post("/api/auth/refresh").send({ refreshToken: reg.body.refreshToken })).status, 401);
  // ...but the caller stays signed in with the fresh session.
  const fresh = { Authorization: `Bearer ${ok.body.accessToken}` };
  assert.equal((await request(a).get("/api/auth/me").set(fresh)).status, 200);
  assert.equal((await request(a).post("/api/auth/refresh").send({ refreshToken: ok.body.refreshToken })).status, 200);
});

test("PATCH /auth/me updates timezone and username; taken username -> 409", { skip }, async () => {
  const a = app();
  const reg = await request(a).post("/api/auth/register").send(validBody());
  await request(a).post("/api/auth/register").send(validBody({ email: "b@example.com", username: "bob" }));
  const auth = { Authorization: `Bearer ${reg.body.accessToken}` };
  const res = await request(a).patch("/api/auth/me").set(auth).send({ timezone: "Asia/Kolkata", username: "Alice_2" });
  assert.equal(res.status, 200);
  assert.equal(res.body.user.timezone, new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Kolkata" }).resolvedOptions().timeZone);
  assert.equal(res.body.user.username, "alice_2");
  const taken = await request(a).patch("/api/auth/me").set(auth).send({ username: "bob" });
  assert.equal(taken.status, 409);
  assert.equal(taken.body.code, "username_taken");
});

test("timezones are canonicalized on register and PATCH /auth/me; invalid -> 400", { skip }, async () => {
  const canonical = (tz: string) => new Intl.DateTimeFormat("en-US", { timeZone: tz }).resolvedOptions().timeZone;
  const a = app();
  const reg = await request(a).post("/api/auth/register").send(validBody({ timezone: "america/new_york" }));
  assert.equal(reg.status, 201);
  assert.equal(reg.body.user.timezone, "America/New_York");
  const auth = { Authorization: `Bearer ${reg.body.accessToken}` };
  const res = await request(a).patch("/api/auth/me").set(auth).send({ timezone: "asia/kolkata" });
  assert.equal(res.status, 200);
  assert.equal(res.body.user.timezone, canonical("Asia/Kolkata"));
  assert.match(res.body.user.timezone, /^Asia\/(Kolkata|Calcutta)$/);
  const bad = await request(a).patch("/api/auth/me").set(auth).send({ timezone: "Mars/Olympus" });
  assert.equal(bad.status, 400);
});

test("delete account -> old access token 401, refresh 401, user row gone", { skip }, async () => {
  const a = app();
  const reg = await request(a).post("/api/auth/register").send(validBody());
  const auth = { Authorization: `Bearer ${reg.body.accessToken}` };
  const wrong = await request(a).delete("/api/auth/account").set(auth).send({ password: "wrong password!!" });
  assert.equal(wrong.status, 401);
  const del = await request(a).delete("/api/auth/account").set(auth).send({ password: PASSWORD });
  assert.equal(del.status, 204);
  assert.equal((await request(a).get("/api/auth/me").set(auth)).status, 401);
  assert.equal((await request(a).post("/api/auth/refresh").send({ refreshToken: reg.body.refreshToken })).status, 401);
  const rows = await db!.select().from(users).where(eq(users.email, "alice@example.com"));
  assert.equal(rows.length, 0);
});

test("GET /auth/me without token -> 401; with garbage token -> 401", { skip }, async () => {
  const a = app();
  const none = await request(a).get("/api/auth/me");
  assert.equal(none.status, 401);
  assert.deepEqual(none.body, { error: "Unauthorized" });
  const bad = await request(a).get("/api/auth/me").set("Authorization", "Bearer garbage");
  assert.equal(bad.status, 401);
});

test("admin: users list and role change are admin-only", { skip }, async () => {
  const a = app();
  const reg = await request(a).post("/api/auth/register").send(validBody());
  const auth = { Authorization: `Bearer ${reg.body.accessToken}` };
  assert.equal((await request(a).get("/api/admin/users").set(auth)).status, 403);
  await db!.update(users).set({ role: "admin" }).where(eq(users.id, reg.body.user.id));
  const other = await request(a).post("/api/auth/register").send(validBody({ email: "b@example.com", username: "bob" }));
  const list = await request(a).get("/api/admin/users?limit=1").set(auth);
  assert.equal(list.status, 200);
  assert.equal(list.body.items.length, 1);
  assert.ok(list.body.nextCursor);
  assert.equal(list.body.items[0].passwordHash, undefined);
  const page2 = await request(a).get(`/api/admin/users?limit=1&cursor=${encodeURIComponent(list.body.nextCursor)}`).set(auth);
  assert.equal(page2.status, 200);
  assert.equal(page2.body.items.length, 1);
  assert.notEqual(page2.body.items[0].id, list.body.items[0].id);
  const patched = await request(a).patch(`/api/admin/users/${other.body.user.id}/role`).set(auth).send({ role: "admin" });
  assert.equal(patched.status, 200);
  assert.equal(patched.body.user.role, "admin");
});

test("admin: demoting the last admin -> 409 last_admin; demoting one of two works", { skip }, async () => {
  const a = app();
  const reg = await request(a).post("/api/auth/register").send(validBody());
  const auth = { Authorization: `Bearer ${reg.body.accessToken}` };
  const me = reg.body.user.id as string;
  await db!.update(users).set({ role: "admin" }).where(eq(users.id, me));
  const self = await request(a).patch(`/api/admin/users/${me}/role`).set(auth).send({ role: "user" });
  assert.equal(self.status, 409);
  assert.equal(self.body.code, "last_admin");
  const other = await request(a).post("/api/auth/register").send(validBody({ email: "b@example.com", username: "bob" }));
  assert.equal((await request(a).patch(`/api/admin/users/${other.body.user.id}/role`).set(auth).send({ role: "admin" })).status, 200);
  const demote = await request(a).patch(`/api/admin/users/${other.body.user.id}/role`).set(auth).send({ role: "user" });
  assert.equal(demote.status, 200);
  assert.equal(demote.body.user.role, "user");
  // Demoting a non-admin when only one admin exists is not a "last admin" case.
  const noop = await request(a).patch(`/api/admin/users/${other.body.user.id}/role`).set(auth).send({ role: "user" });
  assert.equal(noop.status, 200);
});

test("unknown /api path without a token -> 404, not 401", { skip }, async () => {
  const res = await request(app()).get("/api/nope");
  assert.equal(res.status, 404);
  assert.deepEqual(res.body, { error: "Not found" });
});

test("history query validation errors -> 400 Validation failed", { skip }, async () => {
  const a = app();
  const reg = await request(a).post("/api/auth/register").send(validBody());
  const auth = { Authorization: `Bearer ${reg.body.accessToken}` };
  for (const url of [
    "/api/system/messages?limit=0",
    "/api/system/quests/history?from=not-a-date",
    "/api/system/completions/summary?days=999",
  ]) {
    const res = await request(a).get(url).set(auth);
    assert.equal(res.status, 400, url);
    assert.equal(res.body.error, "Validation failed", url);
    assert.ok(Array.isArray(res.body.issues), url);
  }
});

test("system routes require auth", { skip }, async () => {
  const res = await request(app()).get("/api/system/messages");
  assert.equal(res.status, 401);
});

test("healthz is public", async () => {
  const res = await request(createApp({ db: null })).get("/api/healthz");
  assert.equal(res.status, 200);
});

test("register 503 db_unavailable when db null", async () => {
  const res = await request(createApp({ db: null, mailer })).post("/api/auth/register").send(validBody());
  assert.equal(res.status, 503);
  assert.deepEqual(res.body, { error: "Database unavailable", code: "db_unavailable" });
});

test("auth limiters are per-surface: 11 failed logins -> 429 while register still reachable", async () => {
  const a = createApp({ db: null, mailer });
  for (let i = 0; i < 10; i++) {
    const res = await request(a).post("/api/auth/login").send({ email: "x@example.com", password: "nope" });
    assert.equal(res.status, 503, `attempt ${i + 1} should reach the handler chain`);
  }
  const limited = await request(a).post("/api/auth/login").send({ email: "x@example.com", password: "nope" });
  assert.equal(limited.status, 429);
  assert.equal(limited.body.code, "rate_limited");
  const reg = await request(a).post("/api/auth/register").send(validBody());
  assert.notEqual(reg.status, 429);
  assert.equal(reg.status, 503);
});
