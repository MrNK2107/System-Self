import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { eq } from "drizzle-orm";
import { closeTestDb, resetDb } from "@workspace/db/testing";
import { billingEvents, entitlements } from "@workspace/db";
import { BillingStatusSchema } from "@workspace/contracts";
import { createApp } from "../app-factory";
import { assertContract, auth, db, setup, skip } from "./game-test-helpers";

after(async () => {
  await closeTestDb();
});
beforeEach(async () => {
  if (db) await resetDb(db);
});

const SECRET = "whsec_test_secret_value";
const NOW = new Date("2026-03-10T08:00:00Z");
const mailer = { async send() {} };
const app = (secret: string | null = SECRET) => createApp({ db, mailer, now: () => NOW, revenuecatSecret: secret });
const bearer = { Authorization: `Bearer ${SECRET}` };
const T = (iso: string) => Date.parse(iso);

function ev(id: string, type: string, userId: string, atIso: string, expIso?: string, extra: object = {}) {
  return {
    api_version: "1.0",
    event: {
      id,
      type,
      app_user_id: userId,
      event_timestamp_ms: T(atIso),
      ...(expIso ? { expiration_at_ms: T(expIso) } : {}),
      product_id: "system_self_pro_monthly",
      period_type: "NORMAL",
      something_new: { nested: true },
      ...extra,
    },
  };
}
const post = (a: ReturnType<typeof app>, body: unknown, headers: Record<string, string> = bearer) =>
  request(a).post("/api/billing/revenuecat").set(headers).send(body as object);
const row = async (id: string) => (await db!.select().from(entitlements).where(eq(entitlements.userId, id)))[0];

test("webhook is closed without a configured secret or a valid bearer", { skip }, async () => {
  const { id } = await setup(app());
  const body = ev("e1", "INITIAL_PURCHASE", id, "2026-03-10T07:00:00Z", "2026-04-10T07:00:00Z");
  assert.equal((await post(app(null), body)).status, 503);
  assert.equal((await post(app(), body, {})).status, 401);
  assert.equal((await post(app(), body, { Authorization: "Bearer nope" })).status, 401);
  assert.equal((await post(app(), body, { Authorization: "Basic abc" })).status, 401);
  assert.equal(await row(id), undefined);
  assert.equal((await db!.select().from(billingEvents)).length, 0);
});

test("INITIAL_PURCHASE grants pro until expiration_at_ms; status reports it", { skip }, async () => {
  const a = app();
  const { id, token } = await setup(a);
  const res = await post(a, ev("e1", "INITIAL_PURCHASE", id, "2026-03-10T07:00:00Z", "2026-04-10T07:00:00Z"));
  assert.equal(res.status, 200);
  const r = (await row(id))!;
  assert.equal(r.tier, "pro");
  assert.equal(r.source, "revenuecat");
  assert.equal(r.expiresAt!.toISOString(), "2026-04-10T07:00:00.000Z");
  assert.equal(r.productId, "system_self_pro_monthly");
  assert.equal(r.periodType, "NORMAL");
  const st = await request(a).get("/api/billing/status").set(auth(token));
  assert.equal(st.status, 200);
  assert.deepEqual(assertContract(BillingStatusSchema, st.body), {
    tier: "pro",
    expiresAt: "2026-04-10T07:00:00.000Z",
    source: "revenuecat",
  });
  assert.equal((await request(a).get("/api/billing/status")).status, 401);
});

test("status is free without a row and for an expired pro row", { skip }, async () => {
  const a = app();
  const { id, token } = await setup(a);
  const none = await request(a).get("/api/billing/status").set(auth(token));
  assert.deepEqual(none.body, { tier: "free", expiresAt: null, source: null });
  await post(a, ev("e1", "INITIAL_PURCHASE", id, "2026-02-01T00:00:00Z", "2026-03-01T00:00:00Z"));
  const st = await request(a).get("/api/billing/status").set(auth(token));
  assert.equal(st.body.tier, "free");
});

test("a replayed event id is a 200 no-op", { skip }, async () => {
  const a = app();
  const { id } = await setup(a);
  const body = ev("dup", "INITIAL_PURCHASE", id, "2026-03-10T07:00:00Z", "2026-04-10T07:00:00Z");
  assert.equal((await post(a, body)).status, 200);
  await db!.update(entitlements).set({ tier: "free" }).where(eq(entitlements.userId, id));
  assert.equal((await post(a, body)).status, 200);
  assert.equal((await row(id))!.tier, "free", "replay must not re-apply");
  assert.equal((await db!.select().from(billingEvents)).length, 1);
});

test("an EXPIRATION older than the latest RENEWAL does not downgrade (arrives late)", { skip }, async () => {
  const a = app();
  const { id } = await setup(a);
  await post(a, ev("buy", "INITIAL_PURCHASE", id, "2026-01-10T07:00:00Z", "2026-02-10T07:00:00Z"));
  await post(a, ev("renew", "RENEWAL", id, "2026-02-10T07:00:00Z", "2026-03-10T07:00:00Z"));
  const late = await post(a, ev("exp", "EXPIRATION", id, "2026-02-10T06:59:00Z", "2026-02-10T07:00:00Z"));
  assert.equal(late.status, 200);
  const r = (await row(id))!;
  assert.equal(r.tier, "pro");
  assert.equal(r.expiresAt!.toISOString(), "2026-03-10T07:00:00.000Z");
  assert.equal(r.latestEventAt!.toISOString(), "2026-02-10T07:00:00.000Z");
  const stored = await db!.select().from(billingEvents).where(eq(billingEvents.id, "exp"));
  assert.equal(stored.length, 1, "ignored events are still recorded");
});

test("an older RENEWAL cannot move the expiry backwards, and a newer EXPIRATION downgrades", { skip }, async () => {
  const a = app();
  const { id } = await setup(a);
  await post(a, ev("r2", "RENEWAL", id, "2026-02-10T07:00:00Z", "2026-03-10T07:00:00Z"));
  await post(a, ev("r1", "RENEWAL", id, "2026-01-10T07:00:00Z", "2026-02-10T07:00:00Z"));
  assert.equal((await row(id))!.expiresAt!.toISOString(), "2026-03-10T07:00:00.000Z");
  await post(a, ev("x", "EXPIRATION", id, "2026-03-10T07:00:00Z", "2026-03-10T07:00:00Z"));
  assert.equal((await row(id))!.tier, "free");
  // an equal timestamp is applied (>=)
  await post(a, ev("r3", "RENEWAL", id, "2026-03-10T07:00:00Z", "2026-04-10T07:00:00Z"));
  assert.equal((await row(id))!.tier, "pro");
});

test("CANCELLATION and BILLING_ISSUE keep pro until expiration", { skip }, async () => {
  const a = app();
  const { id } = await setup(a);
  await post(a, ev("buy", "INITIAL_PURCHASE", id, "2026-03-01T07:00:00Z", "2026-04-01T07:00:00Z"));
  await post(a, ev("c", "CANCELLATION", id, "2026-03-05T07:00:00Z", "2026-04-01T07:00:00Z"));
  await post(a, ev("b", "BILLING_ISSUE", id, "2026-03-06T07:00:00Z", "2026-04-01T07:00:00Z"));
  const r = (await row(id))!;
  assert.equal(r.tier, "pro");
  assert.equal(r.expiresAt!.toISOString(), "2026-04-01T07:00:00.000Z");
});

test("unknown, non-uuid or missing app_user_id answers 200 and changes nothing", { skip }, async () => {
  const a = app();
  const unknown = "3f1c2b6e-0000-4000-8000-000000000000";
  assert.equal((await post(a, ev("u1", "INITIAL_PURCHASE", unknown, "2026-03-10T07:00:00Z", "2026-04-10T07:00:00Z"))).status, 200);
  assert.equal((await post(a, ev("u2", "INITIAL_PURCHASE", "$RCAnonymousID:abc", "2026-03-10T07:00:00Z", "2026-04-10T07:00:00Z"))).status, 200);
  assert.equal((await post(a, { event: { id: "u3", type: "TEST" } })).status, 200);
  assert.equal((await db!.select().from(entitlements)).length, 0);
  assert.equal((await db!.select().from(billingEvents)).length, 3);
});

test("unknown event types are ignored with 200; malformed payloads are 400", { skip }, async () => {
  const a = app();
  const { id } = await setup(a);
  assert.equal((await post(a, ev("t1", "SUBSCRIPTION_PAUSED", id, "2026-03-10T07:00:00Z"))).status, 200);
  assert.equal(await row(id), undefined);
  assert.equal((await post(a, { nope: true })).status, 400);
  assert.equal((await post(a, "garbage")).status, 400);
});

import { grantEntitlement } from "../services/entitlements";

test("an active admin grant is never downgraded or re-sourced by webhook events", { skip }, async () => {
  const a = app();
  const { id } = await setup(a);
  await grantEntitlement(db!, id, "pro", null, NOW);
  await post(a, ev("x", "EXPIRATION", id, "2026-03-10T07:00:00Z", "2026-03-10T07:00:00Z"));
  let r = (await row(id))!;
  assert.equal(r.tier, "pro");
  assert.equal(r.source, "admin");
  await post(a, ev("buy", "INITIAL_PURCHASE", id, "2026-03-10T07:30:00Z", "2026-04-10T07:00:00Z"));
  r = (await row(id))!;
  assert.equal(r.source, "admin");
  assert.equal(r.expiresAt, null);
  assert.equal(r.productId, null);
  assert.equal((await db!.select().from(billingEvents)).length, 2, "still recorded");
});

test("once the admin grant has expired, webhook events apply", { skip }, async () => {
  const a = app();
  const { id } = await setup(a);
  await grantEntitlement(db!, id, "pro", new Date("2026-03-01T00:00:00Z"), new Date("2026-02-01T00:00:00Z"));
  await post(a, ev("r", "RENEWAL", id, "2026-03-10T07:00:00Z", "2026-04-10T07:00:00Z"));
  const r = (await row(id))!;
  assert.equal(r.source, "revenuecat");
  assert.equal(r.tier, "pro");
});

test("grantEntitlement clears the revenuecat bookkeeping", { skip }, async () => {
  const a = app();
  const { id } = await setup(a);
  await post(a, ev("buy", "INITIAL_PURCHASE", id, "2026-03-10T07:00:00Z", "2026-04-10T07:00:00Z"));
  await grantEntitlement(db!, id, "pro", null, NOW);
  const r = (await row(id))!;
  assert.equal(r.latestEventAt, null);
  assert.equal(r.productId, null);
  assert.equal(r.periodType, null);
});

test("raw secret header is accepted; SUBSCRIPTION_EXTENDED and NON_RENEWING_PURCHASE grant", { skip }, async () => {
  const a = app();
  const { id } = await setup(a);
  const raw = { Authorization: SECRET };
  assert.equal((await post(a, ev("n1", "NON_RENEWING_PURCHASE", id, "2026-03-10T07:00:00Z", "2026-04-10T07:00:00Z"), raw)).status, 200);
  assert.equal((await row(id))!.tier, "pro");
  assert.equal((await post(a, ev("n2", "SUBSCRIPTION_EXTENDED", id, "2026-03-11T07:00:00Z", "2026-05-10T07:00:00Z"), raw)).status, 200);
  assert.equal((await row(id))!.expiresAt!.toISOString(), "2026-05-10T07:00:00.000Z");
  const { id: id2 } = await setup(a, { email: "b@example.com", username: "bob_1" });
  await post(a, ev("n3", "NON_RENEWING_PURCHASE", id2, "2026-03-10T07:00:00Z"), raw);
  assert.equal(await row(id2), undefined, "no expiry: not granted");
});

test("deleting an account blanks its billing_events payloads but keeps id and type", { skip }, async () => {
  const a = app();
  const { id, token } = await setup(a);
  await post(a, ev("keep", "INITIAL_PURCHASE", id, "2026-03-10T07:00:00Z", "2026-04-10T07:00:00Z"));
  const del = await request(a).delete("/api/auth/account").set(auth(token)).send({ password: "correct horse battery" });
  assert.equal(del.status, 204);
  const [e] = await db!.select().from(billingEvents).where(eq(billingEvents.id, "keep"));
  assert.deepEqual(e!.payload, {});
  assert.equal(e!.type, "INITIAL_PURCHASE");
  assert.equal(e!.userId, null);
});
