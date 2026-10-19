import assert from "node:assert/strict";
import { test } from "node:test";
import { FALLBACK_PLANS, POLL_DELAYS_MS, PRO_FEATURES, isExpoGo, plansFromPackages, pollUntilPro, resolvePurchasesKey } from "./core";

test("Expo Go never gets a purchases key", () => {
  const keys = { iosKey: "appl_x", androidKey: "goog_x" };
  assert.equal(isExpoGo("storeClient"), true);
  assert.equal(resolvePurchasesKey({ executionEnvironment: "storeClient", platform: "ios", ...keys }), null);
  assert.equal(resolvePurchasesKey({ executionEnvironment: "bare", platform: "ios", ...keys }), "appl_x");
  assert.equal(resolvePurchasesKey({ executionEnvironment: "standalone", platform: "android", ...keys }), "goog_x");
});

test("a missing, blank or other-platform key means unavailable", () => {
  assert.equal(resolvePurchasesKey({ executionEnvironment: "standalone", platform: "ios" }), null);
  assert.equal(resolvePurchasesKey({ executionEnvironment: "standalone", platform: "ios", iosKey: "  " }), null);
  assert.equal(resolvePurchasesKey({ executionEnvironment: "standalone", platform: "android", iosKey: "appl_x" }), null);
  assert.equal(resolvePurchasesKey({ executionEnvironment: "standalone", platform: "web", iosKey: "a", androidKey: "b" }), null);
});

test("fallback prices are the constraint values; store prices override per product", () => {
  assert.deepEqual(FALLBACK_PLANS.map((p) => p.price), ["₹499 / month", "₹3,999 / year"]);
  assert.deepEqual(plansFromPackages([]).map((p) => p.price), ["₹499 / month", "₹3,999 / year"]);
  const live = plansFromPackages([{ product: { identifier: "system_self_pro_annual", priceString: "₹3,799.00" } }]);
  assert.equal(live[0]!.price, "₹499 / month");
  assert.equal(live[1]!.price, "₹3,799.00");
});

test("the feature list does not promise anything that scores", () => {
  assert.ok(PRO_FEATURES.length >= 12);
  assert.ok(!PRO_FEATURES.some((f) => /S-rank|score boost|multiplier/i.test(f)));
});


const st = (tier: "free" | "pro") => ({ tier, expiresAt: null, source: null });

test("pollUntilPro stops at the first pro answer and sleeps with backoff", async () => {
  const slept: number[] = [];
  let n = 0;
  const r = await pollUntilPro(async () => st(++n === 3 ? "pro" : "free"), async (ms) => void slept.push(ms));
  assert.equal(r, "pro");
  assert.deepEqual(slept, [1000, 2000]);
});

test("pollUntilPro times out after the full schedule (about 30 s) and survives fetch errors", async () => {
  const slept: number[] = [];
  const r = await pollUntilPro(async () => { throw new Error("offline"); }, async (ms) => void slept.push(ms));
  assert.equal(r, "pending");
  assert.deepEqual(slept, [...POLL_DELAYS_MS]);
  assert.equal(slept.reduce((a, b) => a + b, 0), 29000);
});

test("pollUntilPro makes no further fetches once stop returns true", async () => {
  let fetches = 0;
  let stopped = false;
  const r = await pollUntilPro(
    async () => {
      fetches++;
      return st("free");
    },
    async () => {
      if (fetches === 2) stopped = true;
    },
    POLL_DELAYS_MS,
    () => stopped,
  );
  assert.equal(r, "stopped");
  assert.equal(fetches, 2);
});
