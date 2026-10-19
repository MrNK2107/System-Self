import assert from "node:assert/strict";
import { test } from "node:test";
import type { Season } from "@workspace/contracts";
import { ApiError } from "../api/client";
import {
  MAX_SEASON_DAYS,
  cancelSeason,
  clampSeasonLength,
  describeSeasonError,
  lifeContextOptions,
  scheduleSeason,
  seasonChipLine,
  startDateChoices,
  todayInZone,
} from "./life";

interface Call {
  method: string;
  path: string;
  opts: { body?: unknown; idempotencyKey?: string };
}
function fakeApi(reply: (c: Call) => unknown) {
  const calls: Call[] = [];
  return {
    calls,
    request: async (method: string, path: string, opts: Call["opts"] = {}) => {
      const c = { method, path, opts };
      calls.push(c);
      return reply(c);
    },
  } as never as import("../api/client").ApiClient & { calls: Call[] };
}

const season: Season = { id: "s1", kind: "exam", startsOn: "2026-10-20", endsOn: "2026-10-26", line: "Exam Season. The volume drops. The standard does not." };

test("context options come from the engine labels, all seven in order", () => {
  assert.deepEqual(lifeContextOptions().map((o) => o.key), ["student", "professional", "shift_worker", "athlete", "founder", "parent", "traveling"]);
  assert.equal(lifeContextOptions()[2]!.label, "Shift worker");
});

test("start dates begin tomorrow and run for 14 days; length clamps to 1-14", () => {
  const c = startDateChoices("2026-10-19");
  assert.equal(c.length, 14);
  assert.equal(c[0]!.date, "2026-10-20");
  assert.equal(c[13]!.date, "2026-11-02");
  assert.equal(clampSeasonLength(0), 1);
  assert.equal(clampSeasonLength(99), MAX_SEASON_DAYS);
  assert.equal(clampSeasonLength(6.4), 6);
  assert.equal(clampSeasonLength(Number.NaN), 1);
});

test("the chip shows the season line and when it ends", () => {
  assert.deepEqual(seasonChipLine({ endsOn: "2026-10-26", line: season.line }), {
    title: "Exam Season. The volume drops. The standard does not.",
    meta: "Until 2026-10-26",
  });
});

test("errors: conflict, kind, dates and a started season read in the SYSTEM voice", () => {
  const e = (status: number, code: string) => new ApiError({ kind: "http", message: "x", status, code });
  assert.match(describeSeasonError(e(409, "season_conflict")), /one season at a time|cooldown/i);
  assert.match(describeSeasonError(e(400, "invalid_kind")), /not available/i);
  assert.match(describeSeasonError(e(400, "invalid_dates")), /tomorrow/i);
  assert.match(describeSeasonError(e(409, "season_started")), /already started/i);
  assert.match(describeSeasonError(new ApiError({ kind: "network", message: "n" })), /connection/i);
});

test("scheduleSeason and cancelSeason flush the outbox first and send an idempotency key", async () => {
  const api = fakeApi(() => season);
  const blocked = await scheduleSeason(api, { flushBeforeMutation: async () => false }, { kind: "exam", startsOn: "2026-10-20", lengthDays: 7 }, "s-0");
  assert.deepEqual(blocked, { ok: false, reason: "sync_pending" });
  assert.equal(api.calls.length, 0);
  const res = await scheduleSeason(api, { flushBeforeMutation: async () => true }, { kind: "exam", startsOn: "2026-10-20", lengthDays: 7 }, "s-1");
  assert.ok(res.ok && res.value.id === "s1");
  assert.equal(api.calls[0]!.method, "POST");
  assert.equal(api.calls[0]!.path, "/api/seasons");
  assert.deepEqual(api.calls[0]!.opts.body, { kind: "exam", startsOn: "2026-10-20", lengthDays: 7, clientId: "s-1" });
  assert.equal(api.calls[0]!.opts.idempotencyKey, "s-1");

  const del = await cancelSeason(fakeApi(() => null), { flushBeforeMutation: async () => true }, "s1/../x", "s-2");
  assert.equal(del.ok, true);
  const api2 = fakeApi(() => null);
  await cancelSeason(api2, { flushBeforeMutation: async () => true }, "s1", "s-3");
  assert.equal(api2.calls[0]!.method, "DELETE");
  assert.equal(api2.calls[0]!.path, "/api/seasons/s1");
  assert.equal(api2.calls[0]!.opts.idempotencyKey, "s-3");
});

test("start dates honour the earliest start (cooldown) and today is read in the account timezone", () => {
  const c = startDateChoices("2026-10-19", 14, "2026-10-26");
  assert.equal(c[0]!.date, "2026-10-26");
  assert.equal(c.length, 14);
  // An earliest start before tomorrow changes nothing.
  assert.equal(startDateChoices("2026-10-19", 3, "2026-10-01")[0]!.date, "2026-10-20");
  // 2026-10-19 20:00 UTC is already the 20th in Kolkata and still the 19th in New York.
  const at = new Date("2026-10-19T20:00:00Z");
  assert.equal(todayInZone("Asia/Kolkata", at), "2026-10-20");
  assert.equal(todayInZone("America/New_York", at), "2026-10-19");
  assert.equal(todayInZone("", at, "Asia/Kolkata"), "2026-10-20");
  assert.equal(todayInZone("Mars/Olympus", at, "America/New_York"), "2026-10-19");
});
