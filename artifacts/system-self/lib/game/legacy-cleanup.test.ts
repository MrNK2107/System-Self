import assert from "node:assert/strict";
import { test } from "node:test";
import { LEGACY_CLEANUP_MARKER, cleanupLegacyKeys, type CleanupStorage } from "./legacy-cleanup";

function memoryStorage(keys: string[]): CleanupStorage & { data: Map<string, string> } {
  const data = new Map(keys.map((k) => [k, "x"]));
  return {
    data,
    getAllKeys: async () => [...data.keys()],
    getItem: async (k) => data.get(k) ?? null,
    setItem: async (k, v) => void data.set(k, v),
    multiRemove: async (ks) => ks.forEach((k) => data.delete(k)),
  };
}

const OLD = [
  "@system_self:user",
  "@system_self:scores",
  "@system_self:logs",
  "@system_self:quests",
  "@system_self:quest_chains",
  "@system_self:shadow",
  "@system_self:achievements",
  "@system_self:gym:sessions",
  "@system_self:quest_gen_record",
];
const KEPT = [
  "@system_self:rivals",
  "@system_self:challenges",
  "@system_self:challenge_record",
  "@system_self:rival_taunts",
  "@system_self:rivals_last_drift",
];
const OTHER = ["system_self.outbox.v1", "system_self.rq.v1", "system_self.last_user_id"];

test("first launch removes old @system_self:* game keys except the local rivals keys", async () => {
  const storage = memoryStorage([...OLD, ...KEPT, ...OTHER]);
  assert.equal(await cleanupLegacyKeys(storage), OLD.length);
  assert.deepEqual([...storage.data.keys()].filter((k) => k !== LEGACY_CLEANUP_MARKER).sort(), [...KEPT, ...OTHER].sort());
  assert.ok(storage.data.has(LEGACY_CLEANUP_MARKER));
});

test("it runs once: keys written after the cleanup survive later launches", async () => {
  const storage = memoryStorage(OLD);
  await cleanupLegacyKeys(storage);
  storage.data.set("@system_self:last_debrief", "2026-10-19");
  assert.equal(await cleanupLegacyKeys(storage), 0);
  assert.ok(storage.data.has("@system_self:last_debrief"));
});

test("a failed removal leaves the marker unset so the next launch retries", async () => {
  const storage = memoryStorage(OLD);
  storage.multiRemove = async () => {
    throw new Error("disk full");
  };
  await assert.rejects(cleanupLegacyKeys(storage));
  assert.equal(storage.data.has(LEGACY_CLEANUP_MARKER), false);
});
