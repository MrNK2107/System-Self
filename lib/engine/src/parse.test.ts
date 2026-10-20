import { test } from "node:test";
import assert from "node:assert/strict";
import { PARSE_MAX_PROPOSALS, parseFreeText, splitClauses } from "./parse";

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

test("expense needs an amount, not a duration; meeting a deadline is not a social contact", () => {
  assert.deepEqual(parseFreeText("spent 2 hours studying"), []);
  assert.deepEqual(parseFreeText("spent 12 hours on it"), []);
  assert.deepEqual(parseFreeText("paid 30 minutes attention"), []);
  assert.deepEqual(parseFreeText("met a deadline"), []);
  assert.deepEqual(parseFreeText("called a meeting"), []);
  assert.equal(parseFreeText("met with Sam").length, 1);
  assert.equal(parseFreeText("spent 450 on food").length, 1);
});

test("nothing recognised, or out-of-range numbers, give no proposals", () => {
  assert.deepEqual(parseFreeText("had a weird day"), []);
  assert.deepEqual(parseFreeText(""), []);
  assert.deepEqual(parseFreeText("slept 40 hours"), []);
  assert.deepEqual(parseFreeText("read 0 pages"), []);
});

test("splitClauses: and, then, commas, semicolons and full stops split; numbers stay whole", () => {
  assert.deepEqual(
    splitClauses("slept 7 hours and ran 5km").map((c) => c.text),
    ["slept 7 hours", "ran 5km"],
  );
  assert.deepEqual(
    splitClauses("paid 1,200 for rent; slept 7.5 hrs. Then read 20 pages, and then called mom").map((c) => c.text),
    ["paid 1,200 for rent", "slept 7.5 hrs", "read 20 pages", "called mom"],
  );
  const text = "slept 7 hours and ran 5km";
  for (const c of splitClauses(text)) assert.equal(text.slice(c.at, c.at + c.text.length), c.text);
  assert.deepEqual(splitClauses("  "), []);
});

test("one proposal per clause: sleep and a distance run", () => {
  const p = parseFreeText("slept 7 hours and ran 5km");
  assert.deepEqual(p.map((x) => [x.domain, x.logType]), [["BODY", "sleep"], ["BODY", "workout"]]);
  assert.deepEqual(p[1]!.data, { kind: "Run", minutes: 30, intensity: 3 });
  assert.ok(p[1]!.confidence < p[0]!.confidence, "an estimated duration is less sure");
});

test("one proposal per clause across separators, in text order", () => {
  assert.deepEqual(
    parseFreeText("read 20 pages; spent 300 on lunch then walked 2 km").map((x) => x.logType),
    ["reading", "expense", "workout"],
  );
  assert.deepEqual(parseFreeText("ran 30 minutes, then ran 5k").map((x) => x.logType), ["workout", "workout"]);
});

test("a phrase cut by the splitter still counts from the whole text", () => {
  const p = only("went to the gym and did 40 min");
  assert.deepEqual([p.logType, p.data.minutes], ["workout", 40]);
});
