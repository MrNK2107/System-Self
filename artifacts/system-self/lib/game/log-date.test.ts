import assert from "node:assert/strict";
import { test } from "node:test";
import { localDate } from "@workspace/engine";
import { FREE_DAYS_BACK, PRO_DAYS_BACK, dayOptions, occurredAtFor } from "./log-date";
import { buildLogRequest } from "./actions";

const NOW = new Date("2026-03-10T08:00:00Z"); // Tue 13:30 in Asia/Kolkata
const TZ = "Asia/Kolkata";

test("dayOptions lists today first, 30 days back, labelled in the account timezone", () => {
  const o = dayOptions(NOW, TZ, true);
  assert.equal(o.length, PRO_DAYS_BACK + 1);
  assert.deepEqual(o.slice(0, 4).map((d) => d.label), ["Today", "Yesterday", "Sun 8 Mar", "Sat 7 Mar"]);
  assert.equal(o[0]!.date, "2026-03-10");
  assert.equal(o[30]!.date, "2026-02-08");
  // 00:30 in Kolkata is still the previous day in UTC: the account timezone decides "today".
  assert.equal(dayOptions(new Date("2026-03-09T19:00:00Z"), TZ, true)[0]!.date, "2026-03-10");
});

test("free users are locked beyond 2 days back, PRO users are not", () => {
  const free = dayOptions(NOW, TZ, false);
  assert.deepEqual(free.map((d) => d.locked), free.map((d) => d.daysBack > FREE_DAYS_BACK));
  assert.equal(free[2]!.locked, false);
  assert.equal(free[3]!.locked, true);
  assert.ok(dayOptions(NOW, TZ, true).every((d) => !d.locked));
});

test("occurredAtFor: today is now; earlier days land on their date inside the user's window", () => {
  assert.equal(occurredAtFor(NOW, 0, false), NOW.toISOString());
  for (const [daysBack, pro] of [[1, false], [2, false], [3, true], [30, true]] as const) {
    const at = new Date(occurredAtFor(NOW, daysBack, pro));
    const limit = pro ? 30 * 24 * 3600_000 : 48 * 3600_000;
    assert.ok(NOW.getTime() - at.getTime() < limit, `${daysBack} days back is inside the window`);
    assert.equal(localDate(at, TZ), dayOptions(NOW, TZ, pro)[daysBack]!.date);
  }
});

test("occurredAtFor never goes past the window even when asked to", () => {
  const free = new Date(occurredAtFor(NOW, 30, false));
  assert.ok(NOW.getTime() - free.getTime() < 48 * 3600_000);
});

test("a log built for a chosen day sends that occurredAt; the default stays now", () => {
  const at = occurredAtFor(NOW, 1, false);
  assert.equal((buildLogRequest({ domain: "BODY", type: "generic", occurredAt: at }, "c1", NOW).body as { occurredAt: string }).occurredAt, at);
  assert.equal((buildLogRequest({ domain: "BODY", type: "generic" }, "c2", NOW).body as { occurredAt: string }).occurredAt, NOW.toISOString());
});
