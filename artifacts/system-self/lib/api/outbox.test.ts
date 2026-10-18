import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError } from "./client";
import { createOutbox, type KeyValueStorage, type OutboxItem } from "./outbox";

function memoryStorage(): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    async getItem(k) {
      return data.get(k) ?? null;
    },
    async setItem(k, v) {
      data.set(k, v);
    },
    async removeItem(k) {
      data.delete(k);
    },
  };
}

const item = (id: string): { clientId: string; method: "POST"; path: string; body: unknown } => ({
  clientId: id,
  method: "POST",
  path: "/api/logs",
  body: { clientId: id },
});

const networkErr = () => new ApiError({ kind: "network", message: "offline" });
const httpErr = (status: number, code?: string) => new ApiError({ kind: "http", status, code, message: "x" });

test("outbox flushes in order and stops at a network error", async () => {
  const sent: string[] = [];
  let failOn: string | null = "b";
  const outbox = createOutbox({ getUserId: async () => "u1",
    storage: memoryStorage(),
    send: async (i) => {
      if (i.clientId === failOn) throw networkErr();
      sent.push(i.clientId);
    },
  });
  await outbox.enqueue(item("a"));
  await outbox.enqueue(item("b"));
  await outbox.enqueue(item("c"));
  assert.deepEqual(await outbox.flush(), { sent: 1, remaining: 2 });
  assert.deepEqual(sent, ["a"]);
  assert.deepEqual(outbox.pending().map((i) => i.clientId), ["b", "c"]);
  failOn = null;
  assert.deepEqual(await outbox.flush(), { sent: 2, remaining: 0 });
  assert.deepEqual(sent, ["a", "b", "c"]);
});

test("outbox drops a 422 item and records it as failed", async () => {
  const sent: string[] = [];
  const outbox = createOutbox({ getUserId: async () => "u1",
    storage: memoryStorage(),
    send: async (i) => {
      if (i.clientId === "bad") throw httpErr(422);
      sent.push(i.clientId);
    },
  });
  await outbox.enqueue(item("a"));
  await outbox.enqueue(item("bad"));
  await outbox.enqueue(item("c"));
  assert.deepEqual(await outbox.flush(), { sent: 2, remaining: 0 });
  assert.deepEqual(sent, ["a", "c"]);
  const failed = outbox.failed();
  assert.equal(failed.length, 1);
  assert.equal(failed[0]!.item.clientId, "bad");
  assert.equal(failed[0]!.status, 422);
});

test("outbox keeps items on 408, 429, 5xx and 401 and stops", async () => {
  for (const status of [408, 429, 500, 503, 401]) {
    const outbox = createOutbox({ getUserId: async () => "u1",
      storage: memoryStorage(),
      send: async () => {
        throw httpErr(status);
      },
    });
    await outbox.enqueue(item("a"));
    await outbox.enqueue(item("b"));
    assert.deepEqual(await outbox.flush(), { sent: 0, remaining: 2 }, `status ${status}`);
    assert.equal(outbox.failed().length, 0);
  }
});

test("outbox treats legacy 409 duplicate_client_id as success", async () => {
  const outbox = createOutbox({ getUserId: async () => "u1",
    storage: memoryStorage(),
    send: async () => {
      throw httpErr(409, "duplicate_client_id");
    },
  });
  await outbox.enqueue(item("a"));
  assert.deepEqual(await outbox.flush(), { sent: 1, remaining: 0 });
  assert.equal(outbox.failed().length, 0);
});

test("outbox survives re-creation from storage", async () => {
  const storage = memoryStorage();
  const first = createOutbox({ getUserId: async () => "u1", storage, send: async () => {} });
  await first.enqueue(item("a"));
  await first.enqueue(item("b"));
  assert.ok(storage.data.has("system_self.outbox.v1"));

  const sent: OutboxItem[] = [];
  const second = createOutbox({ getUserId: async () => "u1", storage, send: async (i) => void sent.push(i) });
  await second.ready();
  assert.deepEqual(second.pending().map((i) => i.clientId), ["a", "b"]);
  assert.deepEqual(await second.flush(), { sent: 2, remaining: 0 });
  assert.deepEqual(sent.map((i) => i.clientId), ["a", "b"]);

  const third = createOutbox({ getUserId: async () => "u1", storage, send: async () => {} });
  await third.ready();
  assert.deepEqual(third.pending(), []);
});

test("concurrent flushes share one pass (no double send)", async () => {
  const sent: string[] = [];
  const outbox = createOutbox({ getUserId: async () => "u1",
    storage: memoryStorage(),
    send: async (i) => {
      await new Promise((r) => setTimeout(r, 5));
      sent.push(i.clientId);
    },
  });
  await outbox.enqueue(item("a"));
  await outbox.enqueue(item("b"));
  await Promise.all([outbox.flush(), outbox.flush(), outbox.flush()]);
  assert.deepEqual(sent, ["a", "b"]);
});

test("enqueue during a flush is sent after older items, in order", async () => {
  const sent: string[] = [];
  const outbox = createOutbox({ getUserId: async () => "u1",
    storage: memoryStorage(),
    send: async (i) => {
      await new Promise((r) => setTimeout(r, 5));
      sent.push(i.clientId);
    },
  });
  await outbox.enqueue(item("a"));
  const flushing = outbox.flush();
  await outbox.enqueue(item("b"));
  await flushing;
  await outbox.flush();
  assert.deepEqual(sent, ["a", "b"]);
});

test("flushBeforeMutation is true when empty after flush, false when blocked", async () => {
  let offline = true;
  const outbox = createOutbox({ getUserId: async () => "u1",
    storage: memoryStorage(),
    send: async () => {
      if (offline) throw networkErr();
    },
  });
  assert.equal(await outbox.flushBeforeMutation(), true);
  await outbox.enqueue(item("a"));
  assert.equal(await outbox.flushBeforeMutation(), false);
  offline = false;
  assert.equal(await outbox.flushBeforeMutation(), true);
});

test("enqueue with an existing clientId does not duplicate", async () => {
  const outbox = createOutbox({ getUserId: async () => "u1", storage: memoryStorage(), send: async () => {} });
  await outbox.enqueue(item("a"));
  await outbox.enqueue(item("a"));
  assert.equal(outbox.pending().length, 1);
});

test("subscribe is notified when queued or failed items change, until unsubscribed", async () => {
  let fail = true;
  const outbox = createOutbox({ getUserId: async () => "u1",
    storage: memoryStorage(),
    send: async () => {
      if (fail) throw httpErr(422);
    },
  });
  let calls = 0;
  const unsubscribe = outbox.subscribe(() => {
    calls += 1;
  });
  await outbox.enqueue(item("a"));
  assert.ok(calls >= 1, "enqueue notifies");
  const afterEnqueue = calls;
  await outbox.flush(); // 422 -> parked as failed
  assert.ok(calls > afterEnqueue, "a parked item notifies");
  assert.equal(outbox.failed().length, 1);
  const afterFail = calls;
  await outbox.clearFailed();
  assert.ok(calls > afterFail, "clearFailed notifies");
  unsubscribe();
  const before = calls;
  fail = false;
  await outbox.enqueue(item("b"));
  await outbox.flush();
  assert.equal(calls, before, "no calls after unsubscribe");
});
