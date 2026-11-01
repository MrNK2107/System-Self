import { test } from "node:test";
import assert from "node:assert/strict";
import { isAnchored, vouchAllowed, type DayProof } from "./vouch";

const map = (entries: Record<string, DayProof[]>) => new Map(Object.entries(entries));
const direct: DayProof = { direct: true };
const by = (voucherId: string): DayProof => ({ direct: false, voucherId });

test("a directly proven user is anchored; someone with no proof today is not", () => {
  const p = map({ a: [direct] });
  assert.equal(isAnchored("a", p), true);
  assert.equal(isAnchored("b", p), false);
});

test("a vouch chain counts when it reaches a directly proven person within 3 people", () => {
  // c was vouched by b, b by a, a proved directly: c -> b -> a is 3 people deep.
  const p = map({ a: [direct], b: [by("a")], c: [by("b")] });
  assert.equal(isAnchored("b", p), true);
  assert.equal(isAnchored("c", p), true);
});

test("a chain deeper than 3 people does not count", () => {
  const p = map({ a: [direct], b: [by("a")], c: [by("b")], d: [by("c")] });
  assert.equal(isAnchored("d", p), false);
});

test("a circle of vouches with no direct proof never anchors", () => {
  const p = map({ a: [by("b")], b: [by("a")] });
  assert.equal(isAnchored("a", p), false);
  assert.equal(isAnchored("b", p), false);
});

test("any one anchored voucher is enough", () => {
  const p = map({ x: [direct], a: [by("ghost"), by("x")] });
  assert.equal(isAnchored("a", p), true);
});

test("vouchAllowed: own proof, weekly limit, pair limit, and never yourself", () => {
  const proofs = map({ v: [direct] });
  const base = { voucherId: "v", requesterId: "r", confirmationsThisWeek: 0, pairConfirmationsThisWeek: 0, proofs };
  assert.deepEqual(vouchAllowed(base), { ok: true });
  assert.deepEqual(vouchAllowed({ ...base, proofs: map({}) }), { ok: false, code: "voucher_unproven" });
  assert.deepEqual(vouchAllowed({ ...base, confirmationsThisWeek: 3 }), { ok: false, code: "weekly_limit" });
  assert.deepEqual(vouchAllowed({ ...base, pairConfirmationsThisWeek: 1 }), { ok: false, code: "pair_limit" });
  assert.deepEqual(vouchAllowed({ ...base, requesterId: "v" }), { ok: false, code: "self" });
});
