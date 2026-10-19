import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import { closeTestDb, resetDb } from "@workspace/db/testing";
import { users } from "@workspace/db";
import { EntitlementSchema, ProRequiredSchema } from "@workspace/contracts";
import { app, assertContract, auth, db, setup, skip } from "../routes/game-test-helpers";
import { isPro, requirePro } from "./entitlements";

after(async () => {
  await closeTestDb();
});
beforeEach(async () => {
  if (db) await resetDb(db);
});

const NOW = new Date("2026-03-01T12:00:00Z");
const clockApp = () => app({ now: () => NOW });

async function admin() {
  const u = await setup(clockApp(), { email: "boss@example.com", username: "boss_1" });
  await db!.update(users).set({ role: "admin" }).where(eq(users.id, u.id));
  return u;
}

test("isPro: false by default, true after an admin grant, false after expiry", { skip }, async () => {
  const boss = await admin();
  const u = await setup(clockApp(), { email: "pat@example.com", username: "pat_1" });
  assert.equal(await isPro(db!, u.id, NOW), false);

  const grant = await request(clockApp())
    .post(`/api/admin/users/${u.id}/entitlement`)
    .set(auth(boss.token))
    .send({ tier: "pro", expiresAt: "2026-03-10T00:00:00Z" });
  assert.equal(grant.status, 200, JSON.stringify(grant.body));
  const dto = assertContract(EntitlementSchema, grant.body);
  assert.equal(dto.tier, "pro");
  assert.equal(dto.source, "admin");
  assert.equal(await isPro(db!, u.id, NOW), true);
  assert.equal(await isPro(db!, u.id, new Date("2026-03-09T23:59:59Z")), true);
  assert.equal(await isPro(db!, u.id, new Date("2026-03-10T00:00:00Z")), false, "expired at the instant");
  assert.equal(await isPro(db!, u.id, new Date("2026-04-01T00:00:00Z")), false);

  // no expiry, then revoked
  assert.equal((await request(clockApp()).post(`/api/admin/users/${u.id}/entitlement`).set(auth(boss.token)).send({ tier: "pro" })).status, 200);
  assert.equal(await isPro(db!, u.id, new Date("2030-01-01T00:00:00Z")), true);
  const revoke = await request(clockApp()).post(`/api/admin/users/${u.id}/entitlement`).set(auth(boss.token)).send({ tier: "free" });
  assert.equal(revoke.status, 200);
  assert.equal(await isPro(db!, u.id, NOW), false);
});

test("the entitlement route is admin-only, validates its body and 404s an unknown user", { skip }, async () => {
  const boss = await admin();
  const u = await setup(clockApp(), { email: "pat@example.com", username: "pat_1" });
  const url = `/api/admin/users/${u.id}/entitlement`;
  assert.equal((await request(clockApp()).post(url).set(auth(u.token)).send({ tier: "pro" })).status, 403);
  assert.equal(await isPro(db!, u.id, NOW), false, "a user cannot grant themselves PRO");
  assert.equal((await request(clockApp()).post(url).send({ tier: "pro" })).status, 401);
  assert.equal((await request(clockApp()).post(url).set(auth(boss.token)).send({ tier: "gold" })).status, 400);
  assert.equal((await request(clockApp()).post(url).set(auth(boss.token)).send({ tier: "pro", expiresAt: "tomorrow" })).status, 400);
  assert.equal((await request(clockApp()).post("/api/admin/users/not-a-uuid/entitlement").set(auth(boss.token)).send({ tier: "pro" })).status, 400);
  const missing = await request(clockApp())
    .post("/api/admin/users/00000000-0000-4000-8000-000000000000/entitlement")
    .set(auth(boss.token))
    .send({ tier: "pro" });
  assert.equal(missing.status, 404);
});

test("requirePro answers 402 { code: pro_required } for free users and passes PRO users", { skip }, async () => {
  const boss = await admin();
  const u = await setup(clockApp(), { email: "pat@example.com", username: "pat_1" });
  const gated = express();
  gated.use((req, _res, next) => {
    req.user = { id: req.header("x-user")!, role: "user", username: "x" };
    next();
  });
  gated.get("/gated", requirePro(db!, () => NOW), (_req, res) => void res.json({ ok: true }));

  const denied = await request(gated).get("/gated").set("x-user", u.id);
  assert.equal(denied.status, 402);
  assertContract(ProRequiredSchema, denied.body);
  assert.equal(denied.body.code, "pro_required");

  await request(clockApp()).post(`/api/admin/users/${u.id}/entitlement`).set(auth(boss.token)).send({ tier: "pro" });
  const ok = await request(gated).get("/gated").set("x-user", u.id);
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body, { ok: true });
});
