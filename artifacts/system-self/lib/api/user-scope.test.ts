import assert from "node:assert/strict";
import { test } from "node:test";
import { QueryClient } from "@tanstack/react-query";
import {
  persistQueryClientRestore,
  persistQueryClientSave,
  type PersistedClient,
  type Persister,
} from "@tanstack/react-query-persist-client";
import { createOutbox, type KeyValueStorage } from "./outbox";
import { activeKey } from "../game/gym";
import { LAST_USER_KEY, createLocalDataManager, pendingLocalCount } from "./user-scope";

function memoryStorage(): KeyValueStorage {
  const data = new Map<string, string>();
  return {
    getItem: async (k) => data.get(k) ?? null,
    setItem: async (k, v) => void data.set(k, v),
    removeItem: async (k) => void data.delete(k),
  };
}

function memoryPersister() {
  let stored: PersistedClient | undefined;
  const persister: Persister = {
    persistClient: async (c) => {
      stored = c;
    },
    restoreClient: async () => stored,
    removeClient: async () => {
      stored = undefined;
    },
  };
  return { persister, peek: () => stored };
}

const entry = (id: string) => ({ clientId: id, method: "POST" as const, path: "/api/logs", body: {} });

test("a dehydrated cache restores into a fresh QueryClient", async () => {
  const { persister } = memoryPersister();
  const a = new QueryClient();
  a.setQueryData(["state"], { level: 7 });
  await persistQueryClientSave({ queryClient: a, persister });

  const b = new QueryClient();
  await persistQueryClientRestore({ queryClient: b, persister, maxAge: 24 * 60 * 60 * 1000 });
  assert.deepEqual(b.getQueryData(["state"]), { level: 7 });
});

function setup(initialUser: string) {
  const storage = memoryStorage();
  let uid = initialUser;
  const offline = async () => {
    throw new Error("offline");
  };
  const outbox = createOutbox({ storage, getUserId: async () => uid, send: offline });
  const queryClient = new QueryClient();
  const p = memoryPersister();
  const mgr = createLocalDataManager({ storage, outbox, queryClient, persister: p.persister });
  return { storage, outbox, queryClient, p, mgr, setUser: (u: string) => void (uid = u) };
}

test("clearLocalData empties outbox, query cache and persisted cache", async () => {
  const s = setup("A");
  await s.outbox.enqueue(entry("a1"));
  s.queryClient.setQueryData(["state"], { x: 1 });
  await persistQueryClientSave({ queryClient: s.queryClient, persister: s.p.persister });
  assert.ok(s.p.peek());

  await s.mgr.clearLocalData();
  assert.deepEqual(s.outbox.pending(), []);
  assert.equal(s.queryClient.getQueryData(["state"]), undefined);
  assert.equal(s.p.peek(), undefined);
});

test("signing in as a different user clears local data; the same user keeps it", async () => {
  const s = setup("A");
  await s.mgr.handleSignIn("A");
  await s.outbox.enqueue(entry("a1"));
  s.queryClient.setQueryData(["state"], { x: 1 });

  await s.mgr.handleSignIn("A"); // session expiry then re-login: same user
  assert.equal(s.outbox.pending().length, 1);
  assert.deepEqual(s.queryClient.getQueryData(["state"]), { x: 1 });

  s.setUser("B");
  await s.mgr.handleSignIn("B");
  assert.equal(s.queryClient.getQueryData(["state"]), undefined);
  assert.equal(await s.storage.getItem(LAST_USER_KEY), "B");
  s.setUser("A");
  assert.deepEqual(await s.outbox.flush(), { sent: 0, remaining: 0 });
});

test("a missing last-user marker counts as a different user and clears leftovers", async () => {
  const s = setup("A");
  await s.outbox.enqueue(entry("a1"));
  s.queryClient.setQueryData(["state"], { x: 1 });
  await s.mgr.handleSignIn("A");
  assert.deepEqual(s.outbox.pending(), []);
  assert.equal(s.queryClient.getQueryData(["state"]), undefined);
  assert.equal(await s.storage.getItem(LAST_USER_KEY), "A");
});

test("clearLocalData removes the signed-out users persisted gym session, and only theirs", async () => {
  const s = setup("A");
  await s.storage.setItem(activeKey("A"), "{}");
  await s.storage.setItem(activeKey("B"), "{}");
  await s.mgr.clearLocalData("A");
  assert.equal(await s.storage.getItem(activeKey("A")), null);
  assert.equal(await s.storage.getItem(activeKey("B")), "{}");
});

test("clearLocalData without an id uses the last signed-in user", async () => {
  const s = setup("A");
  await s.mgr.handleSignIn("A");
  await s.storage.setItem(activeKey("A"), "{}");
  await s.mgr.clearLocalData();
  assert.equal(await s.storage.getItem(activeKey("A")), null);
});

test("switching users drops the previous users gym session", async () => {
  const s = setup("A");
  await s.mgr.handleSignIn("A");
  await s.storage.setItem(activeKey("A"), "{}");
  await s.mgr.handleSignIn("B");
  assert.equal(await s.storage.getItem(activeKey("A")), null);
});

test("pendingLocalCount adds the users queued outbox entries and unsent gym sets", async () => {
  const s = setup("A");
  assert.equal(await pendingLocalCount({ outbox: s.outbox, storage: s.storage, userId: "A" }), 0);
  await s.outbox.enqueue(entry("a1"));
  await s.outbox.enqueue(entry("a2"));
  const set = { exerciseId: "ex_squat", reps: 5, weight: 40, completed: true, setIndex: 0 };
  await s.storage.setItem(
    activeKey("A"),
    JSON.stringify({ session: null, queue: [{ key: "k1", sessionId: "s1", set }], pendingStart: null }),
  );
  await s.storage.setItem(
    activeKey("B"),
    JSON.stringify({ session: null, queue: [{ key: "k9", sessionId: "s9", set }], pendingStart: null }),
  );
  assert.equal(await pendingLocalCount({ outbox: s.outbox, storage: s.storage, userId: "A" }), 3);
  assert.equal(await pendingLocalCount({ outbox: s.outbox, storage: s.storage, userId: null }), 2);
});
