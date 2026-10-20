import assert from "node:assert/strict";
import { test } from "node:test";
import { appliedLine } from "./echo";

test("applied line: what the server applied, largest first", () => {
  assert.equal(appliedLine([{ domain: "DISCIPLINE", actualDelta: 3 }]), "+3 DISCIPLINE. Logged.");
  assert.equal(
    appliedLine([
      { domain: "WEALTH", actualDelta: 1.25 },
      { domain: "DISCIPLINE", actualDelta: 3.3 },
    ]),
    "+3.3 DISCIPLINE. +1.3 WEALTH. Logged.",
  );
});

test("applied line: losses keep their sign; nothing moved reads 'Logged.'", () => {
  assert.equal(appliedLine([{ domain: "DISCIPLINE", actualDelta: -1.5 }]), "−1.5 DISCIPLINE. Logged.");
  assert.equal(appliedLine([{ domain: "BODY", actualDelta: 0 }]), "Logged.");
  assert.equal(appliedLine([]), "Logged.");
});
