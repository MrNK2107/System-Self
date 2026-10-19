import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { closeTestDb, resetDb } from "@workspace/db/testing";
import { analyticsEvents, pushTokens, refreshTokens, idempotencyKeys, noticePushes, notificationLog, notices } from "@workspace/db";
import { sql } from "drizzle-orm";
import { ANALYTICS_EVENT_TTL_MS, pruneAnalyticsEvents } from "../services/analytics";
import { app, db, setup, skip } from "../routes/game-test-helpers";
import { pruneOrphanedPushTokens, prunePushLogs } from "./notifications";
import { runWorkerTick } from "./run-loop";

after(async () => {
  await closeTestDb();
});
beforeEach(async () => {
  if (db) await resetDb(db);
});

const NOW = new Date("2026-10-19T08:00:00Z");
const OLD = new Date(NOW.getTime() - 31 * 86_400_000);

async function seedOldLog(userId: string, n: number) {
  await db!.insert(notificationLog).values(Array.from({ length: n }, () => ({ userId, localDate: "2026-09-18", kind: "rank_change", sentAt: OLD })));
}

test("prune deletes in bounded batches: at most maxBatches x batch rows per call", { skip }, async () => {
  const { id } = await setup(app());
  await seedOldLog(id, 25);
  assert.equal(await prunePushLogs(db!, NOW, { batch: 10, maxBatches: 2 }), 20);
  assert.equal((await db!.select().from(notificationLog)).length, 5);
  assert.equal(await prunePushLogs(db!, NOW, { batch: 10, maxBatches: 2 }), 5);
  assert.equal((await db!.select().from(notificationLog)).length, 0);
});

test("prune also bounds notice_pushes and keeps recent rows", { skip }, async () => {
  const { id } = await setup(app());
  const rows = await db!
    .insert(notices)
    .values(Array.from({ length: 3 }, () => ({ userId: id, kind: "rank_change", payload: {} })))
    .returning();
  await db!.insert(noticePushes).values([
    { noticeId: rows[0]!.id, userId: id, decision: "sent", decidedAt: OLD },
    { noticeId: rows[1]!.id, userId: id, decision: "sent", decidedAt: OLD },
    { noticeId: rows[2]!.id, userId: id, decision: "sent", decidedAt: NOW },
  ]);
  assert.equal(await prunePushLogs(db!, NOW, { batch: 1, maxBatches: 1 }), 1);
  assert.equal(await prunePushLogs(db!, NOW), 1);
  assert.deepEqual((await db!.select().from(noticePushes)).map((r) => r.noticeId), [rows[2]!.id]);
});

test("a failing push prune is logged and does not skip the idempotency-key prune", { skip }, async () => {
  const { id } = await setup(app());
  await db!.insert(idempotencyKeys).values({ userId: id, key: "k", route: "r", createdAt: new Date(NOW.getTime() - 8 * 86_400_000) } as never);
  const boom = async () => {
    throw new Error("prune failed");
  };
  await runWorkerTick(db!, NOW, undefined, 200, async () => [], boom);
  assert.equal((await db!.select().from(idempotencyKeys).where(eq(idempotencyKeys.key, "k"))).length, 0);
});

test("analytics_events older than 90 days are pruned in bounded batches; recent rows stay", { skip }, async () => {
  const { id } = await setup(app());
  const old = new Date(NOW.getTime() - ANALYTICS_EVENT_TTL_MS - 60_000);
  const recent = new Date(NOW.getTime() - ANALYTICS_EVENT_TTL_MS + 60_000);
  assert.equal(ANALYTICS_EVENT_TTL_MS, 90 * 86_400_000);
  await db!.delete(analyticsEvents);
  await db!.insert(analyticsEvents).values([
    ...Array.from({ length: 25 }, () => ({ userId: id, name: "old_event", createdAt: old })),
    { userId: id, name: "recent_event", createdAt: recent },
  ]);
  assert.equal(await pruneAnalyticsEvents(db!, NOW, { batch: 10, maxBatches: 2 }), 20);
  assert.equal(await pruneAnalyticsEvents(db!, NOW), 5);
  assert.deepEqual((await db!.select().from(analyticsEvents)).map((r) => r.name), ["recent_event"]);
});

test("the worker tick prunes analytics_events, and a failing push prune does not stop it", { skip }, async () => {
  const { id } = await setup(app());
  await db!.delete(analyticsEvents);
  await db!.insert(analyticsEvents).values({ userId: id, name: "old_event", createdAt: new Date(NOW.getTime() - 91 * 86_400_000) });
  await runWorkerTick(db!, NOW, undefined, 200, async () => [], async () => {
    throw new Error("prune failed");
  });
  assert.equal((await db!.select().from(analyticsEvents).where(eq(analyticsEvents.name, "old_event"))).length, 0);
});

test("retention prunes are index-backed: billing_events.received_at and analytics_events.created_at", { skip }, async () => {
  const res = await db!.execute(sql`select tablename, indexdef from pg_indexes where tablename in ('billing_events', 'analytics_events')`);
  const defs = (res.rows as { tablename: string; indexdef: string }[]).map((r) => r.indexdef);
  assert.ok(defs.some((d) => /billing_events USING btree \(received_at\)/.test(d)), defs.join("; "));
  assert.ok(defs.some((d) => /analytics_events USING btree \(created_at\)/.test(d)), defs.join("; "));
});

test("push tokens of users without a valid refresh token for 30 days are pruned; active sessions keep theirs", { skip }, async () => {
  const day = 86_400_000;
  const a = app();
  const live = await setup(a, { email: "live@example.com", username: "live_1" });
  const stale = await setup(a, { email: "stale@example.com", username: "stale_1" });
  const recent = await setup(a, { email: "recent@example.com", username: "recent_1" });
  // live: the session from setup is valid at NOW (expires in the future, never revoked).
  await db!.update(refreshTokens).set({ expiresAt: new Date(NOW.getTime() + day) }).where(eq(refreshTokens.userId, live.id));
  // stale: revoked 31 days ago, and every other token expired 40 days ago.
  await db!.update(refreshTokens).set({ expiresAt: new Date(NOW.getTime() - 40 * day) }).where(eq(refreshTokens.userId, stale.id));
  // recent: its last token was revoked 29 days ago, so it was valid within the window.
  await db!.update(refreshTokens).set({ expiresAt: new Date(NOW.getTime() + day), revokedAt: new Date(NOW.getTime() - 29 * day) }).where(eq(refreshTokens.userId, recent.id));
  const old = new Date(NOW.getTime() - 60 * day);
  await db!.insert(pushTokens).values([
    { userId: live.id, token: "ExponentPushToken[live]", platform: "ios", lastSeenAt: old },
    { userId: stale.id, token: "ExponentPushToken[stale]", platform: "ios", lastSeenAt: old },
    { userId: recent.id, token: "ExponentPushToken[recent]", platform: "android", lastSeenAt: old },
  ]);
  assert.equal(await pruneOrphanedPushTokens(db!, NOW), 1);
  assert.deepEqual((await db!.select().from(pushTokens)).map((r) => r.token).sort(), ["ExponentPushToken[live]", "ExponentPushToken[recent]"]);
  // Bounded batches, and the worker tick runs it.
  await db!.update(refreshTokens).set({ expiresAt: new Date(NOW.getTime() - 40 * day) });
  assert.equal(await pruneOrphanedPushTokens(db!, NOW, { batch: 1, maxBatches: 1 }), 1);
  await runWorkerTick(db!, NOW, undefined, 200, async () => []);
  assert.equal((await db!.select().from(pushTokens)).length, 0);
});
