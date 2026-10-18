import assert from "node:assert/strict";
import { test } from "node:test";
import type { OutboxItem } from "../api/outbox";
import { buildLogRequest } from "./actions";
import { pendingSetChanged, trackSentLogs } from "./pending";
import type { LogEntry } from "./types";

const item = (clientId: string): OutboxItem => ({
  ...buildLogRequest({ domain: "BODY", type: "workout" }, clientId, new Date("2026-10-19T10:00:00.000Z")),
  userId: "u1",
});

test("pendingSetChanged is true when any previous id left, even if the count is the same", () => {
  assert.equal(pendingSetChanged([item("a")], [item("a")]), false);
  assert.equal(pendingSetChanged([item("a"), item("b")], [item("a"), item("b"), item("c")]), false, "additions alone do not refetch");
  assert.equal(pendingSetChanged([item("a"), item("b")], [item("a")]), true);
  assert.equal(pendingSetChanged([item("a")], [item("b")]), true, "one left, one arrived: count unchanged");
  assert.equal(pendingSetChanged([], []), false);
});

test("trackSentLogs keeps sent logs visible until the server list has them", () => {
  const empty = new Map<string, LogEntry>();
  const failed = new Set<string>();

  // a is sent (left the queue, not failed); b is still queued; c failed.
  let recent = trackSentLogs(empty, [item("a"), item("b"), item("c")], [item("b")], new Set(["c"]), new Set());
  assert.deepEqual([...recent.keys()], ["a"]);
  assert.equal(recent.get("a")!.pending, false);

  // a refetch that lacks it keeps it; unrelated churn returns the same map.
  assert.equal(trackSentLogs(recent, [item("b")], [item("b")], failed, new Set()), recent);

  // once the server list carries it, it is dropped.
  recent = trackSentLogs(recent, [item("b")], [item("b")], failed, new Set(["a"]));
  assert.equal(recent.size, 0);
});

test("trackSentLogs ignores non-log outbox items", () => {
  const other: OutboxItem = { clientId: "x", method: "POST", path: "/api/other", body: {}, userId: "u1" };
  assert.equal(trackSentLogs(new Map(), [other], [], new Set(), new Set()).size, 0);
});
