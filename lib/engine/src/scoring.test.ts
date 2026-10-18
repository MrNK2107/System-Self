import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyDelta,
  decayPerDomain,
  logChanges,
  refusalOutcome,
  streakBreaks,
  streakMultiplier,
  type DomainState,
} from "./scoring";

const st = (over: Partial<DomainState> = {}): DomainState => ({
  domain: "BODY",
  score: 50,
  streak: 3,
  lastLogDate: "2026-10-18",
  ...over,
});

test("applyDelta BODY 50 streak 3 +2.5 bonus", () => {
  const r = applyDelta(st(), 2.5, { bonus: true, activity: true, date: "2026-10-19" });
  assert.equal(r.actualDelta, 3.3);
  assert.equal(r.next.score, 53.3);
});

test("applyDelta streak 12 caps multiplier at 2.0", () => {
  assert.equal(streakMultiplier(12), 2.0);
  const r = applyDelta(st({ streak: 12 }), 2.5, { bonus: true, activity: true, date: "2026-10-19" });
  assert.equal(r.actualDelta, 5);
});

test("negative delta never uses the multiplier and does not touch the streak with activity false", () => {
  const r = applyDelta(st({ streak: 12 }), -2, { bonus: true, activity: false, date: "2026-10-19" });
  assert.equal(r.actualDelta, -2);
  assert.equal(r.next.streak, 12);
  assert.equal(r.next.lastLogDate, "2026-10-18");
});

test("no bonus means no multiplier", () => {
  const r = applyDelta(st({ streak: 12 }), 5, { bonus: false, activity: true, date: "2026-10-19" });
  assert.equal(r.actualDelta, 5);
});

test("activity: next day increments, same day keeps, gap resets to 1", () => {
  const o = { bonus: false, activity: true };
  const next = applyDelta(st(), 1, { ...o, date: "2026-10-19" });
  assert.equal(next.next.streak, 4);
  assert.equal(next.next.lastLogDate, "2026-10-19");
  const same = applyDelta(next.next, 1, { ...o, date: "2026-10-19" });
  assert.equal(same.next.streak, 4);
  const gap = applyDelta(st(), 1, { ...o, date: "2026-10-22" });
  assert.equal(gap.next.streak, 1);
  const first = applyDelta(st({ streak: 0, lastLogDate: null }), 1, { ...o, date: "2026-10-19" });
  assert.equal(first.next.streak, 1);
});

test("score clamps at 100 and 0, actualDelta reflects the clamp", () => {
  const hi = applyDelta(st({ score: 99 }), 2.5, { bonus: false, activity: false, date: "2026-10-19" });
  assert.equal(hi.next.score, 100);
  assert.equal(hi.actualDelta, 1);
  const lo = applyDelta(st({ score: 0.5 }), -2, { bonus: false, activity: false, date: "2026-10-19" });
  assert.equal(lo.next.score, 0);
  assert.equal(lo.actualDelta, -0.5);
});

test("logChanges", () => {
  assert.deepEqual(logChanges("BODY", false), [{ domain: "BODY", delta: 2.5, bonus: true, activity: true }]);
  assert.deepEqual(logChanges("SOCIAL", true), [
    { domain: "SOCIAL", delta: 5, bonus: false, activity: true },
    { domain: "DISCIPLINE", delta: -2, bonus: false, activity: false },
  ]);
});

test("streakBreaks penalty caps at 6 and includes DISCIPLINE", () => {
  const d = "2026-10-19";
  const mk = (domain: DomainState["domain"], streak: number, last: string): DomainState => ({
    domain, score: 50, streak, lastLogDate: last,
  });
  const one = streakBreaks(
    [mk("BODY", 2, "2026-10-18"), mk("MIND", 2, d), mk("DISCIPLINE", 0, "2026-10-01")],
    d,
  );
  assert.deepEqual(one, { broken: ["BODY"], penalty: 2 });
  const all = streakBreaks(
    [mk("BODY", 1, "2026-10-18"), mk("MIND", 1, "2026-10-18"), mk("WEALTH", 1, "2026-10-18"),
     mk("SOCIAL", 1, "2026-10-18"), mk("DISCIPLINE", 1, "2026-10-18")],
    d,
  );
  assert.equal(all.broken.length, 5);
  assert.ok(all.broken.includes("DISCIPLINE"));
  assert.equal(all.penalty, 6);
});

test("decayPerDomain", () => {
  assert.equal(decayPerDomain(0), 0);
  assert.equal(decayPerDomain(1), 0);
  assert.equal(decayPerDomain(2), 0.3);
  assert.equal(decayPerDomain(4), 0.3);
  assert.equal(decayPerDomain(5), 0.6);
  assert.equal(decayPerDomain(30), 0.6);
});

test("refusalOutcome", () => {
  assert.deepEqual(refusalOutcome(0), { allowed: true, penalty: 0 });
  assert.deepEqual(refusalOutcome(1), { allowed: true, penalty: 1.5 });
  assert.deepEqual(refusalOutcome(2), { allowed: false, penalty: 0 });
});

test("applyDelta activity on an earlier date than lastLogDate keeps streak and lastLogDate", () => {
  const r = applyDelta(st({ streak: 4, lastLogDate: "2026-10-19" }), 2.5, { bonus: false, activity: true, date: "2026-10-17" });
  assert.equal(r.next.streak, 4);
  assert.equal(r.next.lastLogDate, "2026-10-19");
  assert.equal(r.next.score, 52.5);
});
