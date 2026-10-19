// RevenueCat's own published sample webhook bodies (fixtures/revenuecat-sample-events.json, copied verbatim from
// their docs) must parse and be handled: every one answers 200, a granting event makes the user pro, EXPIRATION makes
// them free again, and the event types we do not act on are recorded and ignored rather than rejected.
import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import request from "supertest";
import { eq } from "drizzle-orm";
import { closeTestDb, resetDb } from "@workspace/db/testing";
import { billingEvents, entitlements } from "@workspace/db";
import { createApp } from "../app-factory";
import { db, setup, skip } from "./game-test-helpers";

after(async () => {
  await closeTestDb();
});
beforeEach(async () => {
  if (db) await resetDb(db);
});

interface Sample {
  api_version: string;
  event: Record<string, unknown> & { id: string; type: string };
}
const { events: SAMPLES } = JSON.parse(
  readFileSync(fileURLToPath(new URL("./fixtures/revenuecat-sample-events.json", import.meta.url)), "utf8"),
) as { events: Sample[] };

const SECRET = "whsec_sample_secret_value";
const NOW = new Date("2026-03-10T08:00:00Z");
const mailer = { async send() {} };
const app = () => createApp({ db, mailer, now: () => NOW, revenuecatSecret: SECRET });
const DAY = 86_400_000;

/** A sample re-addressed to our user, with a unique id, ordered timestamps and (when it has one) a future expiry. */
function adopt(s: Sample, userId: string, i: number): Sample {
  const e = { ...s.event, id: `${s.event.id}-${i}`, event_timestamp_ms: NOW.getTime() - (100 - i) * 60_000 };
  if ("app_user_id" in e) e.app_user_id = userId;
  if (typeof e.expiration_at_ms === "number") e.expiration_at_ms = NOW.getTime() + 30 * DAY;
  if (Array.isArray(e.transferred_to)) e.transferred_to = [userId];
  return { ...s, event: e };
}

const post = (body: unknown) =>
  request(app()).post("/api/billing/revenuecat").set({ Authorization: `Bearer ${SECRET}` }).send(body);

test("the published sample set covers the lifecycle events the handler acts on", () => {
  const types = new Set(SAMPLES.map((s) => s.event.type));
  for (const t of ["INITIAL_PURCHASE", "RENEWAL", "CANCELLATION", "UNCANCELLATION", "EXPIRATION", "BILLING_ISSUE", "PRODUCT_CHANGE", "TRANSFER"]) {
    assert.ok(types.has(t), t);
  }
});

test("every published RevenueCat sample event is accepted with 200 and recorded once", { skip }, async () => {
  const me = await setup(app());
  for (const [i, s] of SAMPLES.entries()) {
    const res = await post(adopt(s, me.id, i));
    assert.equal(res.status, 200, `${s.event.type}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  const rows = await db!.select({ id: billingEvents.id }).from(billingEvents);
  assert.equal(rows.length, SAMPLES.length);
});

test("the published INITIAL_PURCHASE grants pro, and the published EXPIRATION after it revokes it", { skip }, async () => {
  const me = await setup(app());
  const purchase = SAMPLES.find((s) => s.event.type === "INITIAL_PURCHASE")!;
  const expiration = SAMPLES.find((s) => s.event.type === "EXPIRATION")!;
  assert.equal((await post(adopt(purchase, me.id, 1))).status, 200);
  let [row] = await db!.select().from(entitlements).where(eq(entitlements.userId, me.id));
  assert.equal(row?.tier, "pro");
  assert.equal(row?.source, "revenuecat");
  assert.equal((await post(adopt(expiration, me.id, 2))).status, 200);
  [row] = await db!.select().from(entitlements).where(eq(entitlements.userId, me.id));
  assert.equal(row?.tier, "free");
});
