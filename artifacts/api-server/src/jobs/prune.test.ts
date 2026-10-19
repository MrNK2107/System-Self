import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { closeTestDb, resetDb } from "@workspace/db/testing";
import { analyticsEvents, emailCodes, pushTokens, refreshTokens, idempotencyKeys, noticePushes, notificationLog, notices } from "@workspace/db";
import { randomUUID } from "node:crypto";
import { env } from "../lib/env";
import { sql } from "drizzle-orm";
import { ANALYTICS_EVENT_TTL_MS, pruneAnalyticsEvents } from "../services/analytics";
import { app, db, setup, skip } from "../routes/game-test-helpers";
import { ORPHAN_PUSH_TOKEN_TTL_MS, pruneOrphanedPushTokens, prunePushLogs } from "./notifications";
import { EMAIL_CODE_RETENTION_MS, REFRESH_TOKEN_RETENTION_MS, pruneEmailCodes, pruneIdempotencyKeys, pruneRefreshTokens, runWorkerTick } from "./run-loop";

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

// --- P8 final review I-5 / M-3 / M-4 / M-5 ---
const DAY = 86_400_000;
const ago = (ms: number) => new Date(NOW.getTime() - ms);

async function seedRefresh(userId: string, rows: { tag: string; expiresAt: Date; revokedAt?: Date | null }[]) {
  await db!.insert(refreshTokens).values(
    rows.map((r) => ({ userId, familyId: randomUUID(), tokenHash: `hash-${r.tag}`, expiresAt: r.expiresAt, revokedAt: r.revokedAt ?? null })),
  );
}
const remainingRefresh = async () =>
  (await db!.select().from(refreshTokens)).map((r) => r.tokenHash).filter((h) => h.startsWith("hash-")).sort();

test("refresh-token retention outlives the token TTL (reuse detection) and the orphan push-token window", () => {
  // A rotated token is revoked no earlier than it was issued and expires TTL after issue, so keeping it
  // RETENTION >= TTL past least(expires_at, revoked_at) keeps it until at least its own expiry: presenting it while
  // it could still have been valid finds the revoked row and revokes the family (rotateRefreshToken handleRevoked).
  assert.ok(REFRESH_TOKEN_RETENTION_MS >= env.REFRESH_TOKEN_TTL_DAYS * DAY);
  // pruneOrphanedPushTokens looks for tokens whose validity ended within ORPHAN_PUSH_TOKEN_TTL_MS: never prune those.
  assert.ok(REFRESH_TOKEN_RETENTION_MS >= ORPHAN_PUSH_TOKEN_TTL_MS);
  assert.equal(REFRESH_TOKEN_RETENTION_MS, 30 * DAY);
  assert.equal(EMAIL_CODE_RETENTION_MS, DAY);
});

test("refresh tokens are pruned RETENTION after they stopped being valid (expired or revoked), in bounded batches", { skip }, async () => {
  const { id } = await setup(app());
  const r = REFRESH_TOKEN_RETENTION_MS;
  const future = new Date(NOW.getTime() + DAY);
  await seedRefresh(id, [
    { tag: "expired-old", expiresAt: ago(r + DAY) },
    { tag: "revoked-old", expiresAt: future, revokedAt: ago(r + DAY) },
    { tag: "revoked-old-2", expiresAt: future, revokedAt: ago(r + 2 * DAY) },
    { tag: "expired-recent", expiresAt: ago(r - DAY) },
    { tag: "revoked-recent", expiresAt: future, revokedAt: ago(r - DAY) },
    { tag: "live", expiresAt: future },
  ]);
  assert.equal(await pruneRefreshTokens(db!, NOW, { batch: 2, maxBatches: 1 }), 2);
  assert.equal(await pruneRefreshTokens(db!, NOW), 1);
  assert.deepEqual(await remainingRefresh(), ["hash-expired-recent", "hash-live", "hash-revoked-recent"]);
});

test("pruning refresh tokens does not change which push tokens are orphaned", { skip }, async () => {
  const a = app();
  const recent = await setup(a, { email: "recent2@example.com", username: "recent_2" });
  const stale = await setup(a, { email: "stale2@example.com", username: "stale_2" });
  // recent: every session ended 29 days ago (inside the 30-day orphan window); stale: 31 days ago.
  await db!.update(refreshTokens).set({ expiresAt: ago(29 * DAY) }).where(eq(refreshTokens.userId, recent.id));
  await db!.update(refreshTokens).set({ expiresAt: ago(31 * DAY) }).where(eq(refreshTokens.userId, stale.id));
  await db!.insert(pushTokens).values([
    { userId: recent.id, token: "ExponentPushToken[recent2]", platform: "ios", lastSeenAt: ago(60 * DAY) },
    { userId: stale.id, token: "ExponentPushToken[stale2]", platform: "ios", lastSeenAt: ago(60 * DAY) },
  ]);
  await pruneRefreshTokens(db!, NOW);
  assert.equal(await pruneOrphanedPushTokens(db!, NOW), 1);
  assert.deepEqual((await db!.select().from(pushTokens)).map((r) => r.token), ["ExponentPushToken[recent2]"]);
});

test("email codes are pruned a day after they expire, in bounded batches", { skip }, async () => {
  const { id } = await setup(app());
  await db!.delete(emailCodes);
  const old = ago(EMAIL_CODE_RETENTION_MS + 60_000);
  const recent = ago(EMAIL_CODE_RETENTION_MS - 60_000);
  await db!.insert(emailCodes).values([
    ...Array.from({ length: 3 }, (_, i) => ({ userId: id, purpose: "verify" as const, codeHash: `old-${i}`, expiresAt: old })),
    { userId: id, purpose: "reset" as const, codeHash: "old-consumed", expiresAt: old, consumedAt: ago(EMAIL_CODE_RETENTION_MS + 120_000) },
    { userId: id, purpose: "verify" as const, codeHash: "recent-expired", expiresAt: recent },
    { userId: id, purpose: "reset" as const, codeHash: "recent-consumed", expiresAt: recent, consumedAt: ago(EMAIL_CODE_RETENTION_MS - 30_000) },
    { userId: id, purpose: "verify" as const, codeHash: "live", expiresAt: new Date(NOW.getTime() + 60_000) },
  ]);
  assert.equal(await pruneEmailCodes(db!, NOW, { batch: 2, maxBatches: 1 }), 2);
  assert.equal(await pruneEmailCodes(db!, NOW), 2);
  assert.deepEqual((await db!.select().from(emailCodes)).map((r) => r.codeHash).sort(), ["live", "recent-consumed", "recent-expired"]);
});

test("idempotency keys are pruned in bounded batches", { skip }, async () => {
  const { id } = await setup(app());
  const old = ago(8 * DAY);
  await db!.insert(idempotencyKeys).values(Array.from({ length: 5 }, (_, i) => ({ userId: id, key: `k${i}`, route: "r", createdAt: old })) as never);
  await db!.insert(idempotencyKeys).values({ userId: id, key: "fresh", route: "r", createdAt: NOW } as never);
  assert.equal(await pruneIdempotencyKeys(db!, NOW, { batch: 2, maxBatches: 2 }), 4);
  assert.equal(await pruneIdempotencyKeys(db!, NOW), 1);
  assert.deepEqual((await db!.select().from(idempotencyKeys)).map((r) => r.key), ["fresh"]);
});

test("the worker tick prunes refresh tokens and email codes", { skip }, async () => {
  const { id } = await setup(app());
  await seedRefresh(id, [{ tag: "tick-old", expiresAt: ago(REFRESH_TOKEN_RETENTION_MS + DAY) }]);
  await db!.delete(emailCodes);
  await db!.insert(emailCodes).values({ userId: id, purpose: "verify", codeHash: "tick-old", expiresAt: ago(2 * DAY) });
  await runWorkerTick(db!, NOW, undefined, 200, async () => []);
  assert.deepEqual(await remainingRefresh(), []);
  assert.equal((await db!.select().from(emailCodes)).length, 0);
});

test("an aborted tick skips the prunes and the gym sweep (shutdown stays inside its grace period)", { skip }, async () => {
  const { id } = await setup(app());
  await db!.delete(analyticsEvents);
  await db!.insert(analyticsEvents).values({ userId: id, name: "old_event", createdAt: ago(91 * DAY) });
  await db!.insert(idempotencyKeys).values({ userId: id, key: "k-abort", route: "r", createdAt: ago(8 * DAY) } as never);
  const controller = new AbortController();
  controller.abort();
  let pruned = false;
  await runWorkerTick(db!, NOW, controller.signal, 200, async () => [], async () => {
    pruned = true;
  });
  assert.equal(pruned, false);
  assert.equal((await db!.select().from(analyticsEvents)).length, 1);
  assert.equal((await db!.select().from(idempotencyKeys).where(eq(idempotencyKeys.key, "k-abort"))).length, 1);
});

test("retention prunes are index-backed: refresh_tokens.revoked_at, push_tokens.last_seen_at, email_codes.expires_at", { skip }, async () => {
  const res = await db!.execute(sql`select indexdef from pg_indexes where tablename in ('refresh_tokens', 'push_tokens', 'email_codes', 'idempotency_keys')`);
  const defs = (res.rows as { indexdef: string }[]).map((r) => r.indexdef);
  for (const re of [
    /refresh_tokens USING btree \(expires_at\)/,
    /refresh_tokens USING btree \(revoked_at\)/,
    /push_tokens USING btree \(last_seen_at\)/,
    /email_codes USING btree \(expires_at\)/,
    /idempotency_keys USING btree \(created_at\)/,
  ]) {
    assert.ok(defs.some((d) => re.test(d)), `${re}: ${defs.join("; ")}`);
  }
});

test("runLoop records each completed tick: the gauge and the onTick hook (heartbeat file)", { skip }, async () => {
  const { runLoop } = await import("./run-loop");
  const { workerLastTick } = await import("../lib/metrics");
  const controller = new AbortController();
  const ticks: number[] = [];
  const before = Date.now() / 1000;
  await runLoop(db!, {
    tickMs: 60_000,
    signal: controller.signal,
    push: async () => [],
    onTick: async () => {
      ticks.push(Date.now());
      controller.abort();
    },
  });
  assert.equal(ticks.length, 1);
  const value = (await workerLastTick.get()).values[0]!.value;
  assert.ok(value >= Math.floor(before), `${value} >= ${before}`);
});
