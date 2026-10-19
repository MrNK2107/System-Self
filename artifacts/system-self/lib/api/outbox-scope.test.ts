import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError } from "./client";
import { createOutbox, type KeyValueStorage } from "./outbox";

function memoryStorage(): KeyValueStorage {
  const data = new Map<string, string>();
  return {
    getItem: async (k) => data.get(k) ?? null,
    setItem: async (k, v) => void data.set(k, v),
    removeItem: async (k) => void data.delete(k),
  };
}

const entry = (id: string) => ({ clientId: id, method: "POST" as const, path: "/api/logs", body: { clientId: id } });
const networkErr = () => new ApiError({ kind: "network", message: "offline" });
const httpErr = (status: number) => new ApiError({ kind: "http", status, message: "x" });

test("items from user A are not sent with user B session", async () => {
  const storage = memoryStorage();
  let uid: string | null = "A";
  const sent: string[] = [];
  const outbox = createOutbox({ storage, getUserId: async () => uid, send: async (i) => void sent.push(`${i.userId}:${i.clientId}`) });
  await outbox.enqueue(entry("a1"));
  uid = "B";
  assert.deepEqual(await outbox.flush(), { sent: 0, remaining: 0 });
  assert.deepEqual(outbox.pending(), []);
  await outbox.enqueue(entry("b1"));
  assert.deepEqual(await outbox.flush(), { sent: 1, remaining: 0 });
  assert.deepEqual(sent, ["B:b1"]);
  // A returns (same user after a session expiry): their item is still queued.
  uid = "A";
  assert.deepEqual(await outbox.flush(), { sent: 1, remaining: 0 });
  assert.deepEqual(sent, ["B:b1", "A:a1"]);
});

test("enqueue without a signed-in user is rejected", async () => {
  const outbox = createOutbox({ storage: memoryStorage(), getUserId: async () => null, send: async () => {} });
  await assert.rejects(outbox.enqueue(entry("a")), (e: ApiError) => e.status === 401);
});

test("reset empties the outbox and its storage", async () => {
  const storage = memoryStorage();
  const down = async () => {
    throw networkErr();
  };
  const outbox = createOutbox({ storage, getUserId: async () => "u1", send: down });
  await outbox.enqueue(entry("a"));
  await outbox.reset();
  assert.deepEqual(outbox.pending(), []);
  const again = createOutbox({ storage, getUserId: async () => "u1", send: async () => {} });
  await again.ready();
  assert.deepEqual(again.pending(), []);
});

test("poison item: parked as failed after 5 consecutive 5xx attempts, queue continues", async () => {
  const sent: string[] = [];
  const outbox = createOutbox({
    storage: memoryStorage(),
    getUserId: async () => "u1",
    send: async (i) => {
      if (i.clientId === "bad") throw httpErr(500);
      sent.push(i.clientId);
    },
  });
  await outbox.enqueue(entry("bad"));
  await outbox.enqueue(entry("ok"));
  for (let n = 1; n < 5; n++) {
    assert.deepEqual(await outbox.flush(), { sent: 0, remaining: 2 }, `attempt ${n}`);
  }
  assert.deepEqual(await outbox.flush(), { sent: 1, remaining: 0 });
  assert.deepEqual(sent, ["ok"]);
  assert.equal(outbox.failed()[0]!.reason, "poison");
  assert.equal(outbox.failed()[0]!.item.clientId, "bad");
});

test("poison counter ignores network errors", async () => {
  let mode: "net" | "500" = "net";
  const outbox = createOutbox({
    storage: memoryStorage(),
    getUserId: async () => "u1",
    send: async () => {
      throw mode === "net" ? networkErr() : httpErr(500);
    },
  });
  await outbox.enqueue(entry("a"));
  for (let n = 0; n < 10; n++) await outbox.flush();
  assert.equal(outbox.pending().length, 1);
  assert.equal(outbox.failed().length, 0);
  mode = "500";
  for (let n = 0; n < 4; n++) await outbox.flush();
  assert.equal(outbox.pending().length, 1);
});

test("flushBeforeMutation picks up an item enqueued during an in-flight flush", async () => {
  const sent: string[] = [];
  const outbox = createOutbox({
    storage: memoryStorage(),
    getUserId: async () => "u1",
    send: async (i) => {
      await new Promise((r) => setTimeout(r, 5));
      sent.push(i.clientId);
    },
  });
  await outbox.enqueue(entry("a"));
  const inFlight = outbox.flush();
  await outbox.enqueue(entry("b"));
  assert.equal(await outbox.flushBeforeMutation(), true);
  await inFlight;
  assert.deepEqual(sent, ["a", "b"]);
});

test("a rejected refresh (401 invalid_refresh) never counts as a poison attempt", async () => {
  const outbox = createOutbox({
    storage: memoryStorage(),
    getUserId: async () => "u1",
    send: async () => {
      throw new ApiError({ kind: "http", status: 401, code: "invalid_refresh", message: "Invalid refresh token" });
    },
  });
  await outbox.enqueue(entry("a"));
  for (let n = 0; n < 10; n++) await outbox.flush();
  assert.equal(outbox.pending().length, 1);
  assert.equal(outbox.failed().length, 0);
});
