import assert from "node:assert/strict";
import { test } from "node:test";
import { gymLine, pastSelfLine, pastSelfRows, pastSelfTitle } from "./progress";

const zero = { BODY: 0, MIND: 0, WEALTH: 0, SOCIAL: 0, DISCIPLINE: 0 };

test("title and rows: five domains, baseline -> current (signed delta)", () => {
  assert.equal(pastSelfTitle("DAY 1"), "YOU // DAY 1");
  assert.equal(pastSelfTitle("SINCE 2026-09-01"), "YOU // SINCE 2026-09-01");
  const rows = pastSelfRows({
    baseline: { BODY: 5, MIND: 6, WEALTH: 4, SOCIAL: 7, DISCIPLINE: 3 },
    current: { BODY: 8.5, MIND: 6, WEALTH: 3.2, SOCIAL: 7, DISCIPLINE: 3.04 },
  });
  assert.deepEqual(rows.map((r) => r.domain), ["BODY", "MIND", "WEALTH", "SOCIAL", "DISCIPLINE"]);
  assert.deepEqual(rows.map((r) => r.delta), ["+3.5", "+0.0", "-0.8", "+0.0", "+0.0"]);
  assert.deepEqual(rows.map((r) => r.direction), ["up", "flat", "down", "flat", "flat"]);
  assert.equal(pastSelfLine(rows[0]!), "5.0 → 8.5 (+3.5)");
});

test("an all-zero baseline reads cleanly and the gym line pluralises", () => {
  assert.deepEqual(pastSelfRows({ baseline: zero, current: zero })[0], { domain: "BODY", baseline: "0.0", current: "0.0", delta: "+0.0", direction: "flat" });
  assert.equal(gymLine({ sessionsTotal: 1, prsImproved: 1 }), "1 session · 1 PR");
  assert.equal(gymLine({ sessionsTotal: 0, prsImproved: 3 }), "0 sessions · 3 PRs");
});
