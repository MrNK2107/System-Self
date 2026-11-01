import { test } from "node:test";
import assert from "node:assert/strict";
import { applyDelta } from "./scoring";
import { logChanges, LOG_TYPES, summarizeLog } from "./logs";
import { RANKED_DOMAINS } from "./constants";

const one = (domain: Parameters<typeof logChanges>[0], type: string, data: unknown) => {
  const c = logChanges(domain, type, data, false);
  assert.equal(c.length, 1);
  return c[0]!;
};

test("legacy types score exactly as before (regression)", () => {
  for (const type of ["generic", "gym_session", "floor_session", "home_session", "anything_else"]) {
    assert.deepEqual(logChanges("BODY", type, {}, false), [{ domain: "BODY", delta: 2.5, bonus: true, activity: true }]);
    assert.deepEqual(logChanges("DISCIPLINE", type, undefined, false), [
      { domain: "DISCIPLINE", delta: 3, bonus: true, activity: true },
    ]);
  }
  const base = { BODY: 2.5, MIND: 2.5, WEALTH: 2, SOCIAL: 2, DISCIPLINE: 3 };
  for (const d of RANKED_DOMAINS) assert.equal(logChanges(d, "generic", {}, false)[0]!.delta, base[d]);
});

test("forbidden ignores the log type", () => {
  const expected = [
    { domain: "SOCIAL", delta: 5, bonus: false, activity: true },
    { domain: "DISCIPLINE", delta: -2, bonus: false, activity: false },
  ];
  assert.deepEqual(logChanges("SOCIAL", "generic", {}, true), expected);
  assert.deepEqual(logChanges("SOCIAL", "interaction", { kind: "casual" }, true), expected);
});

test("workout scales base by intensity, with the streak bonus", () => {
  assert.deepEqual(one("BODY", "workout", { kind: "run", minutes: 30, intensity: 5 }), { domain: "BODY", delta: 2.8, bonus: true, activity: true });
  assert.equal(one("BODY", "workout", { kind: "run", minutes: 30, intensity: 4 }).delta, 2.5);
  assert.equal(one("BODY", "workout", { kind: "run", minutes: 30, intensity: 1 }).delta, 1.8);
  const at0 = applyDelta({ domain: "BODY", score: 50, streak: 0, lastLogDate: null }, 2.8, { bonus: true, activity: true, date: "2026-10-19", headroom: false });
  assert.equal(at0.actualDelta, 2.8);
});

test("sleep tiers and quality", () => {
  assert.deepEqual(one("BODY", "sleep", { hours: 7.5, quality: 4 }), { domain: "BODY", delta: 2.5, bonus: true, activity: true });
  assert.deepEqual(one("BODY", "sleep", { hours: 7, quality: 3 }), { domain: "BODY", delta: 2.5, bonus: true, activity: true });
  assert.deepEqual(one("BODY", "sleep", { hours: 6.5, quality: 4 }), { domain: "BODY", delta: 1, bonus: false, activity: true });
  assert.deepEqual(one("BODY", "sleep", { hours: 5, quality: 4 }), { domain: "BODY", delta: -1, bonus: false, activity: true });
  assert.deepEqual(one("BODY", "sleep", { hours: 5, quality: 2 }), { domain: "BODY", delta: -1.5, bonus: false, activity: true });
  assert.deepEqual(one("BODY", "sleep", { hours: 6.5, quality: 1 }), { domain: "BODY", delta: 0.5, bonus: false, activity: true });
  assert.deepEqual(logChanges("BODY", "sleep", { hours: 8, quality: 2 }, false), [
    { domain: "BODY", delta: 2.5, bonus: true, activity: true },
    { domain: "BODY", delta: -0.5, bonus: false, activity: false },
  ]);
});

test("sleep 5h at streak 9: -1.0 (not multiplied) and the streak still increments", () => {
  const c = one("BODY", "sleep", { hours: 5, quality: 4 });
  const r = applyDelta({ domain: "BODY", score: 50, streak: 9, lastLogDate: "2026-10-18" }, c.delta, {
    bonus: c.bonus,
    activity: c.activity,
    date: "2026-10-19",
  });
  assert.equal(r.actualDelta, -1);
  assert.equal(r.next.streak, 10);
  assert.equal(r.next.lastLogDate, "2026-10-19");
});

test("optional-looking text fields may be empty in data (scoring ignores them)", () => {
  assert.equal(one("BODY", "workout", { kind: "", minutes: 30, intensity: 4 }).delta, 2.5);
});

test("meal quality", () => {
  assert.deepEqual(one("BODY", "meal", { description: "x", quality: 5 }), { domain: "BODY", delta: 1, bonus: false, activity: true });
  assert.equal(one("BODY", "meal", { description: "x", quality: 4 }).delta, 1);
  assert.deepEqual(one("BODY", "meal", { description: "x", quality: 3 }), { domain: "BODY", delta: 0.5, bonus: false, activity: true });
  assert.deepEqual(one("BODY", "meal", { description: "x", quality: 2 }), { domain: "BODY", delta: -0.5, bonus: false, activity: true });
  assert.equal(one("BODY", "meal", { description: "x", quality: 1 }).delta, -0.5);
});

test("focus scales by minutes and distraction", () => {
  assert.equal(one("MIND", "focus", { minutes: 60, distraction: 1, subject: "a" }).delta, 2.5);
  assert.equal(one("MIND", "focus", { minutes: 120, distraction: 3, subject: "a" }).delta, 2.5);
  assert.equal(one("MIND", "focus", { minutes: 45, distraction: 1, subject: "a" }).delta, 1.5);
  assert.equal(one("MIND", "focus", { minutes: 30, distraction: 1, subject: "a" }).delta, 1.5);
  assert.equal(one("MIND", "focus", { minutes: 29, distraction: 1, subject: "a" }).delta, 0.8);
  assert.equal(one("MIND", "focus", { minutes: 45, distraction: 4, subject: "a" }).delta, 1.1);
  assert.equal(one("MIND", "focus", { minutes: 90, distraction: 5, subject: "a" }).delta, 1.8);
  assert.deepEqual(one("MIND", "focus", { minutes: 45, distraction: 4, subject: "a" }), { domain: "MIND", delta: 1.1, bonus: true, activity: true });
});

test("interaction kinds", () => {
  assert.equal(one("SOCIAL", "interaction", { kind: "meaningful" }).delta, 2);
  assert.equal(one("SOCIAL", "interaction", { kind: "networking" }).delta, 1.6);
  assert.equal(one("SOCIAL", "interaction", { kind: "casual" }).delta, 0.8);
});

test("wealth logs are +0.5 with no bonus", () => {
  for (const type of ["income", "expense", "saving", "investment"]) {
    assert.deepEqual(one("WEALTH", type, { amount: 100, category: "x" }), { domain: "WEALTH", delta: 0.5, bonus: false, activity: true });
  }
});

test("other typed logs score the base", () => {
  assert.equal(one("MIND", "reading", { pages: 10 }).delta, 2.5);
  assert.equal(one("MIND", "learning", { minutes: 10 }).delta, 2.5);
  assert.equal(one("MIND", "journal", { words: 10 }).delta, 2.5);
  assert.equal(one("SOCIAL", "outreach", { count: 2 }).delta, 2);
  assert.equal(one("SOCIAL", "speaking", { minutes: 2 }).delta, 2);
  assert.equal(one("DISCIPLINE", "deadline_met", { label: "x" }).delta, 3);
  assert.equal(one("DISCIPLINE", "routine", { label: "x" }).delta, 3);
});

test("missing or malformed data falls back to the base", () => {
  assert.equal(one("BODY", "sleep", undefined).delta, 2.5);
  assert.equal(one("BODY", "workout", { intensity: "hard" }).delta, 2.5);
  assert.equal(one("SOCIAL", "interaction", null).delta, 2);
});

test("LOG_TYPES: every domain has types, each with a label and defaults", () => {
  for (const d of RANKED_DOMAINS) {
    assert.ok(LOG_TYPES[d].length >= 1);
    for (const t of LOG_TYPES[d]) {
      assert.ok(t.type && t.label);
      assert.equal(typeof t.defaults, "object");
    }
  }
  assert.deepEqual(LOG_TYPES.BODY.map((t) => t.type).slice(0, 3), ["workout", "sleep", "meal"]);
});

test("summarizeLog", () => {
  const s = (domain: string, logType: string, data: unknown, freeText: string | null = null) =>
    summarizeLog({ domain, logType, data, freeText });
  assert.equal(s("BODY", "sleep", { hours: 7.5, quality: 4 }), "Sleep 7.5h · quality 4");
  assert.equal(s("BODY", "workout", { kind: "Run", minutes: 30, intensity: 5 }), "Run 30 min · intensity 5");
  assert.equal(s("BODY", "meal", { description: "Oats", quality: 4 }), "Oats · quality 4");
  assert.equal(s("MIND", "focus", { minutes: 45, distraction: 4, subject: "Math" }), "Math 45 min · distraction 4");
  assert.equal(s("MIND", "reading", { pages: 20 }), "Read 20 pages");
  assert.equal(s("MIND", "reading", { pages: 1 }), "Read 1 page");
  assert.equal(s("MIND", "learning", { minutes: 30 }), "Learned 30 min");
  assert.equal(s("MIND", "journal", { words: 200 }), "Journal 200 words");
  assert.equal(s("WEALTH", "expense", { amount: 120.5, category: "food" }), "Expense 120.5 · food");
  assert.equal(s("WEALTH", "income", { amount: 5000, category: "salary" }), "Income 5000 · salary");
  assert.equal(s("WEALTH", "saving", { amount: 300 }), "Saved 300");
  assert.equal(s("WEALTH", "investment", { amount: 300 }), "Invested 300");
  assert.equal(s("SOCIAL", "interaction", { kind: "networking" }), "Networking interaction");
  assert.equal(s("SOCIAL", "outreach", { count: 3 }), "Outreach x3");
  assert.equal(s("SOCIAL", "speaking", { minutes: 10 }), "Spoke 10 min");
  assert.equal(s("DISCIPLINE", "deadline_met", { label: "Report" }), "Deadline met · Report");
  assert.equal(s("DISCIPLINE", "routine", { label: "Morning" }), "Routine · Morning");
  assert.equal(s("BODY", "home_session", {}), "Home session");
  assert.equal(s("BODY", "gym_session", {}), "Gym session");
  assert.equal(s("BODY", "floor_session", {}), "Floor session");
});

test("summarizeLog falls back for generic, unknown and malformed logs", () => {
  const s = (logType: string, data: unknown, freeText: string | null = null) => summarizeLog({ domain: "MIND", logType, data, freeText });
  assert.equal(s("generic", {}), "Log");
  assert.equal(s("generic", {}, "ran 5k"), "ran 5k");
  assert.equal(s("generic", { note: "hello" }), "hello");
  assert.equal(s("sleep", {}), "Sleep");
  assert.equal(s("workout", null), "Workout");
  assert.equal(s("mystery_type", {}), "Mystery type");
});
