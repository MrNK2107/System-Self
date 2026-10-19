import { test } from "node:test";
import assert from "node:assert/strict";
import { PARSE_MAX_PROPOSALS, parseFreeText } from "./parse";

const only = (text: string) => {
  const p = parseFreeText(text);
  assert.equal(p.length, 1, `expected one proposal for "${text}", got ${JSON.stringify(p)}`);
  return p[0]!;
};

test("sleep: hours with the default quality", () => {
  const p = only("slept 6 hours");
  assert.deepEqual([p.domain, p.logType, p.data], ["BODY", "sleep", { hours: 6, quality: 3 }]);
  assert.ok(p.confidence > 0 && p.confidence <= 1);
});

test("sleep: fractional hours snap to quarter hours", () => {
  assert.deepEqual(only("I slept 7.6 hrs last night").data, { hours: 7.5, quality: 3 });
});

test("expense: amount and category", () => {
  const p = only("spent 450 on food");
  assert.deepEqual([p.domain, p.logType, p.data], ["WEALTH", "expense", { amount: 450, category: "food" }]);
  assert.deepEqual(only("paid ₹1,200 for groceries").data, { amount: 1200, category: "food" });
  assert.deepEqual(only("spent $12.50 on zzz").data, { amount: 12.5, category: "other" });
});

test("reading: pages", () => {
  const p = only("read 30 pages");
  assert.deepEqual([p.domain, p.logType, p.data], ["MIND", "reading", { pages: 30 }]);
});

test("focus: minutes of deep work, and hours convert", () => {
  const p = only("90 min deep work");
  assert.deepEqual([p.domain, p.logType], ["MIND", "focus"]);
  assert.equal(p.data.minutes, 90);
  assert.equal(only("2 hours of focus").data.minutes, 120);
});

test("social: calling someone is a meaningful interaction", () => {
  const p = only("called mom");
  assert.deepEqual([p.domain, p.logType, (p.data as { kind: string }).kind], ["SOCIAL", "interaction", "meaningful"]);
});

test("workout: minutes", () => {
  const p = only("ran for 40 minutes");
  assert.deepEqual([p.domain, p.logType], ["BODY", "workout"]);
  assert.equal(p.data.minutes, 40);
});

test("several things in one text keep their order, at most 3", () => {
  const p = parseFreeText("slept 6 hours and read 30 pages");
  assert.deepEqual(p.map((x) => x.logType), ["sleep", "reading"]);
  const many = parseFreeText("slept 8 hours, read 10 pages, spent 20 on food, called dad, 30 min deep work");
  assert.equal(many.length, PARSE_MAX_PROPOSALS);
  assert.deepEqual(many.map((x) => x.logType), ["sleep", "reading", "expense"]);
});

test("nothing recognised, or out-of-range numbers, give no proposals", () => {
  assert.deepEqual(parseFreeText("had a weird day"), []);
  assert.deepEqual(parseFreeText(""), []);
  assert.deepEqual(parseFreeText("slept 40 hours"), []);
  assert.deepEqual(parseFreeText("read 0 pages"), []);
});
