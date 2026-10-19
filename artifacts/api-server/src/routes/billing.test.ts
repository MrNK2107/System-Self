import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { eq } from "drizzle-orm";
import { closeTestDb, resetDb } from "@workspace/db/testing";
import { billingEvents, entitlements } from "@workspace/db";
import { BillingStatusSchema } from "@workspace/contracts";
import { createApp } from "../app-factory";
import { grantEntitlement } from "../services/entitlements";
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

// ---- Phase 7 final review ---------------------------------------------------------------------------------------

test("I1: the webhook is exempt from the global per-IP limiter (61 rapid authorised calls, none 429)", { skip }, async () => {
  const a = app();
  const { id } = await setup(a);
  for (let i = 0; i < 61; i++) {
    const res = await post(a, ev(`burst-${i}`, "RENEWAL", id, "2026-03-10T07:00:00Z", "2026-04-10T07:00:00Z"));
    assert.equal(res.status, 200, `call ${i + 1}`);
  }
});

test("a billing event of an unknown user stores only id, type and timestamp (payload {})", { skip }, async () => {
  const a = app();
  const unknown = "3f1c2b6e-0000-4000-8000-000000000000";
  await post(a, ev("anon", "INITIAL_PURCHASE", unknown, "2026-03-10T07:00:00Z", "2026-04-10T07:00:00Z"));
  const [e] = await db!.select().from(billingEvents).where(eq(billingEvents.id, "anon"));
  assert.deepEqual(e!.payload, {});
  assert.equal(e!.type, "INITIAL_PURCHASE");
  assert.equal(e!.userId, null);
  assert.equal(e!.receivedAt.toISOString(), NOW.toISOString());
});

function transferEv(id: string, from: string[], to: string[], atIso = "2026-03-10T07:30:00Z") {
  return { api_version: "1.0", event: { id, type: "TRANSFER", event_timestamp_ms: T(atIso), transferred_from: from, transferred_to: to } };
}

function fakeRevenueCat() {
  /** app user id -> pro expires_date (null = lifetime); absent = no pro entitlement. */
  const subs = new Map<string, string | null>();
  const calls: string[] = [];
  const client = {
    async fetchPro(appUserId: string) {
      calls.push(appUserId);
      if (!subs.has(appUserId)) return { expiresAt: undefined };
      const v = subs.get(appUserId)!;
      return { expiresAt: v === null ? null : new Date(v) };
    },
  };
  return { subs, calls, client };
}

test("I2: TRANSFER re-fetches both accounts: PRO moves to the new account, the old one turns free", { skip }, async () => {
  const rc = fakeRevenueCat();
  const a = createApp({ db, mailer, now: () => NOW, revenuecatSecret: SECRET, revenuecat: rc.client });
  const old = await setup(a);
  const fresh = await setup(a, { email: "b@example.com", username: "bob_1" });
  await post(a, ev("buy", "INITIAL_PURCHASE", old.id, "2026-03-01T07:00:00Z", "2026-04-01T07:00:00Z"));
  assert.equal((await row(old.id))!.tier, "pro");
  // RevenueCat now holds the subscription on the new account only.
  rc.subs.set(fresh.id, "2026-04-01T07:00:00Z");
  const res = await post(a, transferEv("tr1", [old.id, "$RCAnonymousID:x", "3f1c2b6e-0000-4000-8000-000000000000"], [fresh.id]));
  assert.equal(res.status, 200);
  assert.deepEqual([...rc.calls].sort(), [old.id, fresh.id].sort(), "only existing uuid users are fetched");
  const o = (await row(old.id))!;
  assert.equal(o.tier, "free");
  assert.equal(o.source, "revenuecat");
  const n = (await row(fresh.id))!;
  assert.equal(n.tier, "pro");
  assert.equal(n.source, "revenuecat");
  assert.equal(n.expiresAt!.toISOString(), "2026-04-01T07:00:00.000Z");
  // A replay is a no-op and fetches nothing.
  rc.calls.length = 0;
  assert.equal((await post(a, transferEv("tr1", [old.id], [fresh.id]))).status, 200);
  assert.equal(rc.calls.length, 0);
});

test("I2: TRANSFER with a lifetime entitlement (expires_date null) grants PRO with no expiry; admin grants win", { skip }, async () => {
  const rc = fakeRevenueCat();
  const a = createApp({ db, mailer, now: () => NOW, revenuecatSecret: SECRET, revenuecat: rc.client });
  const u = await setup(a);
  const admin = await setup(a, { email: "c@example.com", username: "cat_1" });
  await grantEntitlement(db!, admin.id, "pro", null, NOW);
  rc.subs.set(u.id, null);
  await post(a, transferEv("tr2", [admin.id], [u.id]));
  const r = (await row(u.id))!;
  assert.equal(r.tier, "pro");
  assert.equal(r.expiresAt, null);
  const ad = (await row(admin.id))!;
  assert.equal(ad.source, "admin");
  assert.equal(ad.tier, "pro");
});

test("I2: a failed RevenueCat fetch answers 503 and records nothing, so RevenueCat retries", { skip }, async () => {
  const rc = fakeRevenueCat();
  rc.client.fetchPro = async () => {
    throw new Error("timeout");
  };
  const a = createApp({ db, mailer, now: () => NOW, revenuecatSecret: SECRET, revenuecat: rc.client });
  const u = await setup(a);
  assert.equal((await post(a, transferEv("tr4", [], [u.id]))).status, 503);
  assert.equal((await db!.select().from(billingEvents).where(eq(billingEvents.id, "tr4"))).length, 0);
});

test("the RevenueCat REST client reads subscriber.entitlements.pro.expires_date with a bearer key and a timeout", async () => {
  const { createRevenueCatClient } = await import("../services/entitlements");
  const seen: { url: string; init: RequestInit }[] = [];
  const reply = (body: object, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  const bodies = [
    reply({ subscriber: { entitlements: { pro: { expires_date: "2026-04-01T07:00:00Z" } } } }),
    reply({ subscriber: { entitlements: { pro: { expires_date: null } } } }),
    reply({ subscriber: { entitlements: {} } }),
    reply({ code: 7225 }, 500),
  ];
  const client = createRevenueCatClient({
    apiKey: "sk_test",
    fetch: (async (url: string, init: RequestInit) => {
      seen.push({ url, init });
      return bodies.shift()!;
    }) as never,
  });
  assert.equal((await client.fetchPro("u 1")).expiresAt!.toISOString(), "2026-04-01T07:00:00.000Z");
  assert.equal((await client.fetchPro("u2")).expiresAt, null);
  assert.equal((await client.fetchPro("u3")).expiresAt, undefined);
  await assert.rejects(client.fetchPro("u4"));
  assert.equal(seen[0]!.url, "https://api.revenuecat.com/v1/subscribers/u%201");
  assert.equal((seen[0]!.init.headers as Record<string, string>).Authorization, "Bearer sk_test");
  assert.ok(seen[0]!.init.signal instanceof AbortSignal);
});

test("I2: TRANSFER without REVENUECAT_API_KEY logs a warning and leaves the rows untouched", { skip }, async () => {
  const { mock } = await import("node:test");
  const { logger } = await import("../lib/logger");
  const warn = mock.method(logger, "warn");
  try {
    const a = createApp({ db, mailer, now: () => NOW, revenuecatSecret: SECRET, revenuecat: null });
    const old = await setup(a);
    const fresh = await setup(a, { email: "b@example.com", username: "bob_1" });
    await post(a, ev("buy", "INITIAL_PURCHASE", old.id, "2026-03-01T07:00:00Z", "2026-04-01T07:00:00Z"));
    const before = await row(old.id);
    assert.equal((await post(a, transferEv("tr3", [old.id], [fresh.id]))).status, 200);
    assert.deepEqual(await row(old.id), before);
    assert.equal(await row(fresh.id), undefined);
    assert.ok(
      warn.mock.calls.some((c) => JSON.stringify(c.arguments).includes("revenuecat_transfer_without_api_key")),
      "a warning names the missing key",
    );
  } finally {
    warn.mock.restore();
  }
});

test("billing events older than 180 days are pruned in bounded batches", { skip }, async () => {
  const { pruneBillingEvents } = await import("../services/entitlements");
  const old = new Date(NOW.getTime() - 181 * 86_400_000);
  const recent = new Date(NOW.getTime() - 179 * 86_400_000);
  await db!.insert(billingEvents).values([
    ...Array.from({ length: 5 }, (_, i) => ({ id: `old-${i}`, userId: null, type: "RENEWAL", payload: {}, receivedAt: old })),
    { id: "recent", userId: null, type: "RENEWAL", payload: {}, receivedAt: recent },
  ]);
  assert.equal(await pruneBillingEvents(db!, NOW, { batch: 2, maxBatches: 2 }), 4);
  assert.equal(await pruneBillingEvents(db!, NOW), 1);
  assert.deepEqual((await db!.select().from(billingEvents)).map((e) => e.id), ["recent"]);
});

test("the worker tick prunes billing events older than 180 days", { skip }, async () => {
  const { runWorkerTick } = await import("../jobs/run-loop");
  await db!.insert(billingEvents).values([
    { id: "ancient", userId: null, type: "RENEWAL", payload: {}, receivedAt: new Date(NOW.getTime() - 200 * 86_400_000) },
    { id: "fresh", userId: null, type: "RENEWAL", payload: {}, receivedAt: NOW },
  ]);
  await runWorkerTick(db!, NOW, undefined, 200, async () => []);
  assert.deepEqual((await db!.select().from(billingEvents)).map((e) => e.id), ["fresh"]);
});
