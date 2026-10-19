import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError } from "../api/client";
import { REFUSAL_RULE, hasApiCode, isStaleFailure, isoWeekKey, mutationFailureLine, refuseFailureLine } from "./guards";

test("hasApiCode matches only ApiErrors with that code", () => {
  const e = new ApiError({ kind: "http", status: 409, code: "not_active", message: "x" });
  assert.equal(hasApiCode(e, "not_active"), true);
  assert.equal(hasApiCode(e, "refusal_limit"), false);
  assert.equal(hasApiCode(new Error("x"), "not_active"), false);
  assert.equal(hasApiCode(null, "not_active"), false);
});

test("isoWeekKey changes on Monday in local time and spans year boundaries", () => {
  assert.equal(isoWeekKey(new Date(2026, 9, 18, 23, 59)), isoWeekKey(new Date(2026, 9, 13))); // Sun and Tue, same week
  assert.notEqual(isoWeekKey(new Date(2026, 9, 18, 23, 59)), isoWeekKey(new Date(2026, 9, 19, 0, 1))); // Sun -> Mon
  assert.equal(isoWeekKey(new Date(2026, 0, 1)), isoWeekKey(new Date(2025, 11, 29))); // ISO week 1 of 2026 starts 2025-12-29
});

test("refuse failure copy is the same for every screen", () => {
  const err = (code?: string, kind: "http" | "network" = "http") => ({
    ok: false as const,
    reason: "error" as const,
    error: new ApiError({ kind, status: 409, code, message: "x" }),
  });
  assert.equal(refuseFailureLine(err("refusal_limit")), REFUSAL_RULE);
  assert.equal(refuseFailureLine(err("reason_required")), "A reason is required.");
  assert.equal(refuseFailureLine(err("not_active")), null);
  assert.equal(refuseFailureLine({ ok: false, reason: "sync_pending" }), "Sync pending. Queued logs must land first.");
  assert.equal(refuseFailureLine(err(undefined, "network")), "No connection. Nothing was sent.");
  assert.equal(refuseFailureLine(err("boom")), "Request failed. Try again.");
  assert.equal(mutationFailureLine(err("boom")), "Request failed. Try again.");
  assert.equal(isStaleFailure(err("not_active")), true);
});
