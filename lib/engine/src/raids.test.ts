import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RAID_TYPES,
  groupClans,
  raidDispatchText,
  raidTypeForWeek,
  raidWeekOf,
  raidWindow,
  raidStandings,
  formatRaidValue,
} from "./raids";

const clans = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `c${i + 1}`, clanRank: i + 1 }));
const sizes = (n: number) => groupClans(clans(n)).map((g) => g.length);

test("groupClans: groups of 4, a lone remainder takes one from the previous group", () => {
  assert.deepEqual(sizes(0), []);
  assert.deepEqual(sizes(1), []);
  assert.deepEqual(sizes(2), [2]);
  assert.deepEqual(sizes(3), [3]);
  assert.deepEqual(sizes(4), [4]);
  assert.deepEqual(sizes(5), [3, 2]);
  assert.deepEqual(sizes(6), [4, 2]);
  assert.deepEqual(sizes(7), [4, 3]);
  assert.deepEqual(sizes(8), [4, 4]);
  assert.deepEqual(sizes(9), [4, 3, 2]);
  assert.deepEqual(sizes(13), [4, 4, 3, 2]);
});

test("groupClans: nearest rank together, input order irrelevant, every clan placed once", () => {
  const shuffled = [clans(9)[5]!, clans(9)[0]!, clans(9)[8]!, ...clans(9).filter((c) => ![5, 0, 8].includes(c.clanRank - 1))];
  const groups = groupClans(shuffled);
  assert.deepEqual(groups[0], ["c1", "c2", "c3", "c4"]);
  assert.deepEqual(groups[1], ["c5", "c6", "c7"]);
  assert.deepEqual(groups[2], ["c8", "c9"]);
  assert.equal(new Set(groups.flat()).size, 9);
});

test("raid type rotates by ISO week mod 4", () => {
  assert.deepEqual(RAID_TYPES, ["domain", "discipline", "body", "score"]);
  assert.equal(raidTypeForWeek(4), "domain");
  assert.equal(raidTypeForWeek(5), "discipline");
  assert.equal(raidTypeForWeek(6), "body");
  assert.equal(raidTypeForWeek(7), "score");
  assert.equal(raidTypeForWeek(8), "domain");
  assert.equal(raidTypeForWeek(53), "discipline");
});

test("raidWeekOf: Monday 00:00 UTC to Sunday 23:59 UTC", () => {
  const w = raidWeekOf(new Date("2026-10-21T15:00:00Z")); // Wednesday
  assert.equal(w.weekKey, "2026-W43");
  assert.equal(w.week, 43);
  assert.equal(w.start.toISOString(), "2026-10-19T00:00:00.000Z");
  assert.equal(w.end.toISOString(), "2026-10-25T23:59:00.000Z");
  assert.equal(raidWeekOf(new Date("2026-10-19T00:00:00Z")).weekKey, "2026-W43");
  assert.equal(raidWeekOf(new Date("2026-10-18T23:59:59Z")).weekKey, "2026-W42");
  assert.equal(raidWeekOf(new Date("2026-10-25T23:59:30Z")).weekKey, "2026-W43");
});

test("raidWindow round-trips week keys across a year boundary", () => {
  assert.equal(raidWindow("2026-W43").start.toISOString(), "2026-10-19T00:00:00.000Z");
  assert.equal(raidWindow("2026-W53").start.toISOString(), "2026-12-28T00:00:00.000Z");
  assert.equal(raidWeekOf(new Date("2027-01-03T10:00:00Z")).weekKey, "2026-W53");
  assert.equal(raidWindow("2027-W01").start.toISOString(), "2027-01-04T00:00:00.000Z");
});

test("raidStandings: ranks by value, ties share a position, a tied top has no winner", () => {
  const s = raidStandings([
    { clanId: "a", value: 5 },
    { clanId: "b", value: 9 },
    { clanId: "c", value: 5 },
  ]);
  assert.deepEqual(s.map((x) => [x.clanId, x.position, x.winner]), [
    ["b", 1, true],
    ["a", 2, false],
    ["c", 2, false],
  ]);
  const tie = raidStandings([
    { clanId: "a", value: 7 },
    { clanId: "b", value: 7 },
    { clanId: "c", value: 1 },
  ]);
  assert.deepEqual(tie.map((x) => [x.position, x.winner]), [[1, false], [1, false], [3, false]]);
  assert.deepEqual(raidStandings([]), []);
});

test("formatRaidValue and the dispatch text follow the PRD format, no emoji", () => {
  assert.equal(formatRaidValue("domain", 12), "12");
  assert.equal(formatRaidValue("discipline", 72.456), "72.5%");
  assert.equal(formatRaidValue("score", 3.25), "+3.3");
  assert.equal(formatRaidValue("score", -1.5), "-1.5");
  const text = raidDispatchText({ week: 43, position: 2, count: 3, type: "body", value: 14, rivalValue: 20 });
  assert.equal(text, "RAID RESULT — WEEK 43. Your clan ranked 2 of 3. Body sessions: 14. Rival clan: 20. Gap: 6.");
  assert.doesNotMatch(text, /\p{Extended_Pictographic}/u);
});
