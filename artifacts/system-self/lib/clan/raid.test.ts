import assert from "node:assert/strict";
import { test } from "node:test";
import type { RaidSummary } from "@workspace/contracts";
import type { ApiClient } from "../api/client";
import { fetchRaid, raidPositionLine, raidTimeLeft, raidTitle, raidValueLabel } from "./raid";

const raid: RaidSummary = {
  weekKey: "2026-W44",
  week: 44,
  type: "discipline",
  startsAt: "2026-10-26T00:00:00.000Z",
  endsAt: "2026-11-01T23:59:00.000Z",
  resolved: false,
  standings: [
    { clanId: "6b1d0c7e-1111-4222-8333-444455556666", name: "Alpha", tag: "AL", clanRank: 1, isMine: false, metricValue: 80, position: 1 },
    { clanId: "6b1d0c7e-1111-4222-8333-444455556667", name: "Bravo", tag: "BR", clanRank: 2, isMine: true, metricValue: 62.5, position: 2 },
  ],
  myPosition: 2,
  myValue: 62.5,
};

test("raid title, values and position line", () => {
  assert.equal(raidTitle(raid), "WEEK 44 // DISCIPLINE RAID");
  assert.equal(raidValueLabel("discipline", 62.5), "62.5%");
  assert.equal(raidValueLabel("domain", 12), "12");
  assert.equal(raidValueLabel("score", 2), "+2");
  assert.equal(raidValueLabel("score", null), "—"); // a live score raid shows positions only
  assert.equal(raidPositionLine(raid), "Position 2 of 2.");
  assert.equal(raidPositionLine({ ...raid, resolved: true }), "Raid closed. Position 2 of 2.");
});

test("raidTimeLeft counts down to the close", () => {
  assert.equal(raidTimeLeft(raid.endsAt, new Date("2026-10-30T18:59:00Z")), "2d 5h left");
  assert.equal(raidTimeLeft(raid.endsAt, new Date("2026-11-01T18:49:00Z")), "5h 10m left");
  assert.equal(raidTimeLeft(raid.endsAt, new Date("2026-11-01T23:47:00Z")), "12m left");
  assert.equal(raidTimeLeft(raid.endsAt, new Date("2026-11-01T23:59:30Z")), "closing");
});

test("fetchRaid reads GET /api/clans/raid and validates it", async () => {
  const calls: string[] = [];
  const api = {
    request: async (method: string, path: string, opts: { schema: { parse: (v: unknown) => unknown } }) => {
      calls.push(`${method} ${path}`);
      return opts.schema.parse({ raid });
    },
  } as unknown as ApiClient;
  assert.deepEqual(await fetchRaid(api), raid);
  assert.deepEqual(calls, ["GET /api/clans/raid"]);
});
