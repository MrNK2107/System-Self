import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError } from "./client";
import { PRO_LOCK_LABEL, PAYWALL_ROUTE, isProRequired } from "./pro";

const http = (status: number, code?: string) => new ApiError({ kind: "http", status, code, message: "x" });

test("only a 402 with code pro_required is a PRO lock", () => {
  assert.equal(isProRequired(http(402, "pro_required")), true);
  assert.equal(isProRequired(http(402)), false);
  assert.equal(isProRequired(http(403, "pro_required")), false);
  assert.equal(isProRequired(http(409, "clan_full")), false);
  assert.equal(isProRequired(new ApiError({ kind: "network", message: "x" })), false);
  assert.equal(isProRequired(new Error("x")), false);
  assert.equal(isProRequired(null), false);
});

test("the PRO lock links to the paywall placeholder", () => {
  assert.equal(PAYWALL_ROUTE, "/paywall");
  assert.equal(PRO_LOCK_LABEL, "PRO");
});
