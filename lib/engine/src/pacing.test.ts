import { test } from "node:test";
import assert from "node:assert/strict";
import { DAILY_GAIN_CAP, LOG_DAILY_GAIN_CAP, QUEST_FAIL_PENALTY, RANKED_DOMAINS, type RankedDomain } from "./constants";
import { addDays } from "./dates";
import { hiddenScore } from "./rank";
import { applyDelta, cleanDayChange, questCompletionChanges, upkeepChanges, type ChangeSpec, type DomainState } from "./scoring";

/**
 * The pacing contract (spec section 6.7): simulated users over 180 days, run through the real scoring rules.
 * Each day: 3 normal daily quests on rotating domains (BODY, MIND, WEALTH, SOCIAL), each proven with probability
 * `prove` (else failed), a clean-day bonus when all are done, self-reported logs in every domain (capped), and upkeep.
 */
function simulate(prove: number, opts: { logs?: boolean; days?: number; start?: number } = {}) {
  const days = opts.days ?? 180;
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const states = new Map<RankedDomain, DomainState>(
    RANKED_DOMAINS.map((d) => [d, { domain: d, score: opts.start ?? 20, streak: 0, lastLogDate: null }]),
  );
  const hidden: number[] = [];
  let date = "2026-01-01";
  const order: RankedDomain[] = ["BODY", "MIND", "WEALTH", "SOCIAL"];

  for (let day = 0; day < days; day++) {
    const gained = new Map<RankedDomain, { all: number; logs: number }>(RANKED_DOMAINS.map((d) => [d, { all: 0, logs: 0 }]));
    const apply = (c: ChangeSpec, isLog = false) => {
      const g = gained.get(c.domain)!;
      const cap = isLog ? Math.min(DAILY_GAIN_CAP - g.all, LOG_DAILY_GAIN_CAP - g.logs) : DAILY_GAIN_CAP - g.all;
      const r = applyDelta(states.get(c.domain)!, c.delta, { bonus: c.bonus, activity: c.activity, date, capRemaining: cap });
      states.set(c.domain, r.next as DomainState);
      if (r.actualDelta > 0) {
        g.all += r.actualDelta;
        if (isLog) g.logs += r.actualDelta;
      }
    };
    let clean = true;
    for (let i = 0; i < 3; i++) {
      const domain = order[(day * 3 + i) % 4]!;
      if (rand() < prove) questCompletionChanges(domain, "normal").forEach((c) => apply(c));
      else {
        clean = false;
        apply({ domain: "DISCIPLINE", delta: -QUEST_FAIL_PENALTY.daily, bonus: false, activity: false });
      }
    }
    if (clean) apply(cleanDayChange());
    if (opts.logs !== false) for (const d of RANKED_DOMAINS) apply({ domain: d, delta: 2.5, bonus: true, activity: true }, true);
    upkeepChanges().forEach((c) => apply(c));
    const scores = Object.fromEntries([...states].map(([d, s]) => [d, s.score])) as Record<RankedDomain, number>;
    hidden.push(hiddenScore(scores, 1));
    date = addDays(date, 1);
  }
  return hidden;
}

const firstDayAtOrAbove = (h: number[], v: number) => h.findIndex((x) => x >= v) + 1;

test("a user who proves everything: not maxed in a week, 70s by month two, S no sooner than day 90", () => {
  const h = simulate(1);
  assert.ok(h[6]! < 40, `day 7 hidden ${h[6]}`);
  assert.ok(h[29]! >= 50 && h[29]! <= 70, `day 30 hidden ${h[29]}`);
  assert.ok(h[59]! >= 68 && h[59]! <= 82, `day 60 hidden ${h[59]}`);
  const s = firstDayAtOrAbove(h, 86);
  assert.ok(s >= 90 && s <= 180, `first S day ${s}`);
});

test("a user who proves half their quests settles in the middle", () => {
  const h = simulate(0.5);
  assert.ok(h[179]! >= 45 && h[179]! <= 68, `day 180 hidden ${h[179]}`);
});

test("logging alone, with no proven quests, stays low after a month", () => {
  const h = simulate(0);
  assert.ok(h[29]! < 30, `day 30 hidden ${h[29]}`);
});
