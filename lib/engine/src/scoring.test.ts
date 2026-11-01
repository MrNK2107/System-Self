import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyDelta,
  headroom,
  questCompletionChanges,
  upkeepChanges,
  decayPerDomain,
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

test("applyDelta BODY 50 streak 3 +2.5 bonus: streak 1.15x, then headroom at 50", () => {
  const r = applyDelta(st(), 2.5, { bonus: true, activity: true, date: "2026-10-19" });
  // 2.5 * 1.15 * 0.5^1.8 (0.287) = 0.83
  assert.equal(r.actualDelta, 0.8);
  assert.equal(r.next.score, 50.8);
});

test("streak multiplier grows 0.05 a day and caps at 1.5", () => {
  assert.equal(streakMultiplier(0), 1);
  assert.equal(streakMultiplier(4), 1.2);
  assert.equal(streakMultiplier(10), 1.5);
  assert.equal(streakMultiplier(40), 1.5);
  const r = applyDelta(st({ streak: 12 }), 2.5, { bonus: true, activity: true, date: "2026-10-19", headroom: false });
  assert.equal(r.actualDelta, 3.8);
});

test("headroom: full at 0, shrinking towards a 0.02 floor near 100", () => {
  assert.equal(headroom(0), 1);
  assert.ok(Math.abs(headroom(50) - 0.287) < 0.001);
  assert.ok(headroom(90) < 0.02 + 1e-9 || headroom(90) < 0.02 + 0.001);
  assert.equal(headroom(100), 0.02);
  const low = applyDelta(st({ score: 10, streak: 0 }), 3.5, { bonus: true, activity: true, date: "2026-10-19" });
  const high = applyDelta(st({ score: 80, streak: 0 }), 3.5, { bonus: true, activity: true, date: "2026-10-19" });
  assert.ok(low.actualDelta > high.actualDelta * 10, `${low.actualDelta} vs ${high.actualDelta}`);
});

test("capRemaining clips positive gains, never losses, and a spent cap gives 0", () => {
  const clipped = applyDelta(st({ score: 0, streak: 0 }), 3.5, { bonus: false, activity: true, date: "2026-10-19", capRemaining: 1.2 });
  assert.equal(clipped.actualDelta, 1.2);
  const spent = applyDelta(st({ score: 0, streak: 0 }), 3.5, { bonus: false, activity: true, date: "2026-10-19", capRemaining: 0 });
  assert.equal(spent.actualDelta, 0);
  assert.equal(spent.next.streak, 1, "still counts as activity");
  const loss = applyDelta(st(), -2, { bonus: false, activity: false, date: "2026-10-19", capRemaining: 0 });
  assert.equal(loss.actualDelta, -2);
});

test("questCompletionChanges: base by difficulty to the quest's domain plus 0.8 DISCIPLINE", () => {
  assert.deepEqual(questCompletionChanges("MIND", "hard"), [
    { domain: "MIND", delta: 5.5, bonus: true, activity: true },
    { domain: "DISCIPLINE", delta: 0.8, bonus: false, activity: true },
  ]);
  assert.equal(questCompletionChanges("BODY", "easy")[0]!.delta, 2);
  assert.equal(questCompletionChanges("BODY", "normal")[0]!.delta, 3.5);
});

test("upkeepChanges: -0.1 in every domain, not activity", () => {
  const u = upkeepChanges();
  assert.equal(u.length, 5);
  assert.ok(u.every((c) => c.delta === -0.1 && !c.activity && !c.bonus));
});

test("negative delta never uses the multiplier and does not touch the streak with activity false", () => {
  const r = applyDelta(st({ streak: 12 }), -2, { bonus: true, activity: false, date: "2026-10-19" });
  assert.equal(r.actualDelta, -2);
  assert.equal(r.next.streak, 12);
  assert.equal(r.next.lastLogDate, "2026-10-18");
});

test("no bonus means no multiplier", () => {
  const r = applyDelta(st({ streak: 12 }), 5, { bonus: false, activity: true, date: "2026-10-19", headroom: false });
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
  const hi = applyDelta(st({ score: 99 }), 2.5, { bonus: false, activity: false, date: "2026-10-19", headroom: false });
  assert.equal(hi.next.score, 100);
  assert.equal(hi.actualDelta, 1);
  const lo = applyDelta(st({ score: 0.5 }), -2, { bonus: false, activity: false, date: "2026-10-19" });
  assert.equal(lo.next.score, 0);
  assert.equal(lo.actualDelta, -0.5);
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
  const r = applyDelta(st({ streak: 4, lastLogDate: "2026-10-19" }), 2.5, { bonus: false, activity: true, date: "2026-10-17", headroom: false });
  assert.equal(r.next.streak, 4);
  assert.equal(r.next.lastLogDate, "2026-10-19");
  assert.equal(r.next.score, 52.5);
});
