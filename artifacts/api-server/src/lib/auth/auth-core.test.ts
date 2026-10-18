import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { closeTestDb, getTestDb, resetDb } from "@workspace/db/testing";
import { emailCodes, refreshTokens, users } from "@workspace/db";
import { hashPassword, verifyPassword } from "./passwords";
import { signAccessToken, verifyAccessToken } from "./tokens";
import { issueRefreshToken, rotateRefreshToken } from "./refresh";
import { consumeEmailCode, createEmailCode } from "./codes";

const db = getTestDb();
const skip = db ? false : "TEST_DATABASE_URL not set";

after(async () => {
  await closeTestDb();
});

test("hash/verify roundtrip and wrong password false", async () => {
  const h = await hashPassword("correct horse battery");
  assert.ok(h.startsWith("$argon2id$"));
  assert.equal(await verifyPassword(h, "correct horse battery"), true);
  assert.equal(await verifyPassword(h, "wrong password!!"), false);
  assert.equal(await verifyPassword("not-a-hash", "x"), false);
});

test("access token roundtrip; tampered token -> null; expired -> null", async () => {
  const u = { id: "11111111-1111-1111-1111-111111111111", role: "admin" as const, tokenVersion: 3 };
  const { token, expiresAt } = await signAccessToken(u);
  assert.ok(expiresAt.getTime() > Date.now());
  assert.deepEqual(await verifyAccessToken(token), { userId: u.id, role: "admin", ver: 3 });
  const parts = token.split(".");
  const tampered = `${parts[0]}.${parts[1]}x.${parts[2]}`;
  assert.equal(await verifyAccessToken(tampered), null);
  assert.equal(await verifyAccessToken("garbage"), null);
  const short = await signAccessToken(u, { ttlSec: 1 });
  await new Promise((r) => setTimeout(r, 2100));
  assert.equal(await verifyAccessToken(short.token), null);
});

async function makeUser(): Promise<string> {
  const [row] = await db!
    .insert(users)
    .values({
      email: `u${Math.random()}@x.io`,
      passwordHash: "h",
      username: `u${Math.random()}`,
      birthYear: 2000,
      termsAcceptedAt: new Date(),
    })
    .returning({ id: users.id });
  return row!.id;
}

beforeEach(async () => {
  if (db) await resetDb(db);
});

test("rotate returns new token and old one becomes reused", { skip }, async () => {
  const uid = await makeUser();
  const first = await issueRefreshToken(db!, uid, { userAgent: "t" });
  const r = await rotateRefreshToken(db!, first.token);
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.userId, uid);
    assert.notEqual(r.token, first.token);
  }
  const again = await rotateRefreshToken(db!, first.token);
  assert.deepEqual(again, { ok: false, reason: "reused" });
  assert.deepEqual(await rotateRefreshToken(db!, "nope"), { ok: false, reason: "invalid" });
});

test("reusing a rotated token revokes the family", { skip }, async () => {
  const uid = await makeUser();
  const first = await issueRefreshToken(db!, uid);
  const r = await rotateRefreshToken(db!, first.token);
  assert.ok(r.ok);
  await rotateRefreshToken(db!, first.token); // reuse
  const next = await rotateRefreshToken(db!, r.ok ? r.token : "");
  assert.equal(next.ok, false);
  const rows = await db!.select().from(refreshTokens).where(eq(refreshTokens.userId, uid));
  assert.ok(rows.every((x) => x.revokedAt));
});

test("expired refresh token -> expired", { skip }, async () => {
  const uid = await makeUser();
  const t = await issueRefreshToken(db!, uid);
  await db!.update(refreshTokens).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(refreshTokens.id, t.id));
  assert.deepEqual(await rotateRefreshToken(db!, t.token), { ok: false, reason: "expired" });
});

test("email code: correct ok, second use invalid, 6th wrong attempt locked", { skip }, async () => {
  const uid = await makeUser();
  const code = await createEmailCode(db!, uid, "verify");
  assert.match(code, /^\d{6}$/);
  assert.equal(await consumeEmailCode(db!, uid, "verify", code), "ok");
  assert.equal(await consumeEmailCode(db!, uid, "verify", code), "invalid");

  const c2 = await createEmailCode(db!, uid, "reset");
  const wrong = c2 === "000000" ? "111111" : "000000";
  for (let i = 0; i < 5; i++) assert.equal(await consumeEmailCode(db!, uid, "reset", wrong), "invalid");
  assert.equal(await consumeEmailCode(db!, uid, "reset", wrong), "locked");
  assert.equal(await consumeEmailCode(db!, uid, "reset", c2), "locked");
});

test("new email code invalidates earlier one; expired code -> expired", { skip }, async () => {
  const uid = await makeUser();
  const a = await createEmailCode(db!, uid, "verify");
  const b = await createEmailCode(db!, uid, "verify");
  if (a !== b) assert.equal(await consumeEmailCode(db!, uid, "verify", a), "invalid");
  await db!.update(emailCodes).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(emailCodes.userId, uid));
  assert.equal(await consumeEmailCode(db!, uid, "verify", b), "expired");
});

test("concurrent wrong guesses cannot exceed the attempt limit", { skip }, async () => {
  const uid = await makeUser();
  const code = await createEmailCode(db!, uid, "verify");
  const wrong = code === "000000" ? "111111" : "000000";
  const results = await Promise.all(
    Array.from({ length: 20 }, () => consumeEmailCode(db!, uid, "verify", wrong)),
  );
  assert.equal(results.filter((r) => r === "invalid").length, 5);
  const [row] = await db!.select().from(emailCodes).where(eq(emailCodes.userId, uid));
  assert.ok(row!.attempts <= 5);
  assert.equal(await consumeEmailCode(db!, uid, "verify", code), "locked");
});

test("concurrent rotation of one token: exactly one wins, family revoked", { skip }, async () => {
  const uid = await makeUser();
  const t = await issueRefreshToken(db!, uid);
  const results = await Promise.all([rotateRefreshToken(db!, t.token), rotateRefreshToken(db!, t.token)]);
  assert.equal(results.filter((r) => r.ok).length, 1);
  const loser = results.find((r) => !r.ok);
  assert.deepEqual(loser, { ok: false, reason: "reused" });
  const rows = await db!.select().from(refreshTokens).where(eq(refreshTokens.userId, uid));
  assert.equal(rows.length, 2);
  assert.ok(rows.every((x) => x.revokedAt));
});
