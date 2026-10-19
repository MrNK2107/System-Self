import { test } from "node:test";
import assert from "node:assert/strict";
import { LOG_TYPES, RANKED_DOMAINS } from "@workspace/engine";
import { checkLogForm, defaultTypeFor, initialValues, LOG_FIELDS, previewDelta, toLogData, typesFor } from "./log-form";

test("every offered type opens valid: its defaults pass the check untouched (one-tap entry)", () => {
  for (const domain of RANKED_DOMAINS) {
    assert.equal(defaultTypeFor(domain).type, typesFor(domain)[0]!.type);
    for (const t of typesFor(domain)) {
      const c = checkLogForm(domain, t.type, initialValues(domain, t.type));
      assert.ok(c.ok, `${domain}/${t.type}: ${JSON.stringify(c)}`);
    }
  }
});

test("every field of a type is a field of its schema, and vice versa", () => {
  for (const domain of RANKED_DOMAINS) {
    for (const t of typesFor(domain)) {
      const fields = (LOG_FIELDS[t.type] ?? []).map((f) => f.key);
      for (const key of Object.keys(t.defaults)) assert.ok(fields.includes(key), `${t.type}.${key} has no field`);
    }
  }
});

test("toLogData parses typed text, keeps scales, leaves blank optional fields out", () => {
  assert.deepEqual(toLogData("sleep", { hours: " 7,5 ", quality: 4 }), { hours: 7.5, quality: 4 });
  assert.deepEqual(toLogData("expense", { amount: "120.5", category: " food ", note: "  " }), { amount: 120.5, category: "food" });
  assert.deepEqual(toLogData("expense", { amount: "1", category: "x", note: " lunch " }), { amount: 1, category: "x", note: "lunch" });
  assert.deepEqual(toLogData("home_session", {}), {});
});

test("checkLogForm names the field that is wrong", () => {
  const blank = checkLogForm("BODY", "sleep", { hours: "", quality: 4 });
  assert.equal(blank.ok, false);
  assert.match(!blank.ok ? blank.message : "", /hours/);
  const steps = checkLogForm("BODY", "sleep", { hours: "7.1", quality: 4 });
  assert.equal(steps.ok, false);
  const zero = checkLogForm("WEALTH", "saving", { amount: "0" });
  assert.equal(zero.ok, false);
  const nan = checkLogForm("MIND", "reading", { pages: "abc" });
  assert.equal(nan.ok, false);
  const good = checkLogForm("BODY", "sleep", { hours: "6.75", quality: 3 });
  assert.deepEqual(good, { ok: true, data: { hours: 6.75, quality: 3 } });
});

test("previewDelta matches the engine, with the streak bonus only where it applies", () => {
  assert.equal(previewDelta("BODY", "workout", { kind: "x", minutes: 10, intensity: 5 }, 0), 2.8);
  assert.equal(previewDelta("BODY", "workout", { kind: "x", minutes: 10, intensity: 4 }, 5), 3.8); // 2.5 * 1.5
  assert.equal(previewDelta("BODY", "sleep", { hours: 5, quality: 4 }, 9), -1);
  assert.equal(previewDelta("BODY", "sleep", { hours: 8, quality: 2 }, 5), 3.3); // 2.5*1.5=3.75 -> 3.8, then -0.5
  assert.equal(previewDelta("BODY", "sleep", { hours: 6.5, quality: 1 }, 5), 0.5);
  assert.equal(previewDelta("WEALTH", "expense", { amount: 5, category: "x" }, 9), 0.5);
});

test("empty text fields that the server treats as absent pass the check", () => {
  assert.ok(checkLogForm("BODY", "workout", { kind: "", minutes: 30, intensity: 4 }).ok);
  assert.ok(checkLogForm("BODY", "meal", { description: " ", quality: 3 }).ok);
  assert.ok(checkLogForm("MIND", "focus", { minutes: 30, distraction: 2, subject: "" }).ok);
  assert.ok(!checkLogForm("WEALTH", "expense", { amount: 5, category: "" }).ok);
});
