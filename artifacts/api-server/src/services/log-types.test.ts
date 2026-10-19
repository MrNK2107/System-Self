import { test } from "node:test";
import assert from "node:assert/strict";
import { LOG_TYPES, RANKED_DOMAINS, logChanges } from "@workspace/engine";
import { LOG_DATA_SCHEMAS, parseLogData } from "@workspace/contracts";

test("every offered log type has a contract schema and its defaults validate", () => {
  for (const domain of RANKED_DOMAINS) {
    for (const t of LOG_TYPES[domain]) {
      const r = parseLogData(domain, t.type, t.defaults);
      assert.ok(r.ok, `${domain}/${t.type}: ${JSON.stringify(r)}`);
    }
  }
});

test("every typed contract schema is offered or special, and the PRD types exist", () => {
  const special = new Set(["generic", "gym_session", "floor_session", "home_session"]);
  for (const domain of RANKED_DOMAINS) {
    const offered = new Set(LOG_TYPES[domain].map((t) => t.type));
    for (const type of Object.keys(LOG_DATA_SCHEMAS[domain])) assert.ok(special.has(type) || offered.has(type), `${domain}/${type}`);
  }
  const expected = {
    BODY: ["workout", "sleep", "meal"],
    MIND: ["focus", "reading", "learning", "journal"],
    WEALTH: ["income", "expense", "saving", "investment"],
    SOCIAL: ["interaction", "outreach", "speaking"],
    DISCIPLINE: ["deadline_met", "routine"],
  } as const;
  for (const d of RANKED_DOMAINS) for (const t of expected[d]) assert.ok(t in LOG_DATA_SCHEMAS[d], `${d}/${t}`);
});

test("parseLogData: bounds from the PRD", () => {
  const ok = (d: "BODY" | "MIND" | "WEALTH" | "SOCIAL" | "DISCIPLINE", t: string, data: unknown) => parseLogData(d, t, data).ok;
  assert.ok(ok("BODY", "sleep", { hours: 0, quality: 1 }));
  assert.ok(ok("BODY", "sleep", { hours: 16, quality: 5 }));
  assert.ok(ok("BODY", "sleep", { hours: 7.25, quality: 3 }));
  assert.ok(!ok("BODY", "sleep", { hours: 7.3, quality: 3 }));
  assert.ok(!ok("BODY", "workout", { kind: "x".repeat(41), minutes: 10, intensity: 3 }));
  assert.ok(!ok("BODY", "workout", { kind: "x", minutes: 601, intensity: 3 }));
  assert.ok(!ok("BODY", "meal", { description: "x".repeat(121), quality: 3 }));
  assert.ok(!ok("MIND", "focus", { minutes: 0, distraction: 1, subject: "x" }));
  assert.ok(!ok("MIND", "focus", { minutes: 10, distraction: 1, subject: "x".repeat(61) }));
  assert.ok(!ok("MIND", "reading", { pages: 2001 }));
  assert.ok(!ok("MIND", "journal", { words: 20001 }));
  assert.ok(!ok("WEALTH", "saving", { amount: -1 }));
  assert.ok(ok("WEALTH", "income", { amount: 10.5, category: "pay", note: "x" }));
  assert.ok(!ok("SOCIAL", "interaction", { kind: "casual", note: "x".repeat(201) }));
  assert.ok(!ok("SOCIAL", "speaking", { minutes: 301 }));
  assert.ok(!ok("DISCIPLINE", "routine", { label: "x".repeat(81) }));
  assert.ok(ok("MIND", "generic", {}));
});

test("a validated payload scores through logChanges", () => {
  const r = parseLogData("MIND", "focus", { minutes: 45, distraction: 4, subject: "Math" });
  assert.ok(r.ok);
  assert.equal(logChanges("MIND", "focus", r.data, false)[0]!.delta, 1.1);
});
