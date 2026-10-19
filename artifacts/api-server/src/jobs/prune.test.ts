import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { closeTestDb, resetDb } from "@workspace/db/testing";
import { idempotencyKeys, noticePushes, notificationLog, notices } from "@workspace/db";
import { app, db, setup, skip } from "../routes/game-test-helpers";
import { prunePushLogs } from "./notifications";
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
