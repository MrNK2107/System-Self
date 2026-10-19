import test from "node:test";
import assert from "node:assert/strict";
import {
  COMEBACK_CHECKLIST,
  HOME_LOG_TYPES,
  HOME_SESSIONS_TO_UNLOCK,
  checklistDone,
  isComeback,
  shouldOfferHomePath,
} from "./comeback";

test("checklist keys are fixed", () => {
  assert.deepEqual(
    COMEBACK_CHECKLIST.map((c) => c.key),
    ["body_session", "quests_today", "two_domains"],
  );
  assert.equal(COMEBACK_CHECKLIST[0]!.label, "Log one BODY session");
});

test("isComeback: needs a prior activity date on or after onboarding and 5+ empty days", () => {
  assert.deepEqual(isComeback(null, "2026-03-20", "2026-03-01"), { comeback: false, gapDays: 0 });
  // last activity 03-10, today 03-16: empty days 03-11..03-15 = 5
  assert.deepEqual(isComeback("2026-03-10", "2026-03-16", "2026-03-01"), { comeback: true, gapDays: 5 });
  // only 4 empty days
  assert.deepEqual(isComeback("2026-03-10", "2026-03-15", "2026-03-01"), { comeback: false, gapDays: 4 });
  // consecutive days and same day are never a gap
  assert.deepEqual(isComeback("2026-03-15", "2026-03-15", "2026-03-01"), { comeback: false, gapDays: 0 });
  assert.deepEqual(isComeback("2026-03-15", "2026-03-16", "2026-03-01"), { comeback: false, gapDays: 0 });
  // activity before onboarding is not a gap after onboarding
  assert.deepEqual(isComeback("2026-02-01", "2026-03-20", "2026-03-01"), { comeback: false, gapDays: 0 });
  // a backdated log earlier than the last activity is not a comeback
  assert.deepEqual(isComeback("2026-03-20", "2026-03-10", "2026-03-01"), { comeback: false, gapDays: 0 });
});

test("shouldOfferHomePath: 14+ day gap or no gym sessions", () => {
  assert.equal(shouldOfferHomePath(14, 10), true);
  assert.equal(shouldOfferHomePath(13, 10), false);
  assert.equal(shouldOfferHomePath(6, 0), true);
});

test("checklistDone reads today's logs and quests", () => {
  const none = { logs: [], questsCompletedToday: 0, dailiesPending: 0 };
  assert.deepEqual(checklistDone(none), { body_session: false, quests_today: false, two_domains: false });
  const all = {
    logs: [{ domain: "BODY" }, { domain: "MIND" }],
    questsCompletedToday: 2,
    dailiesPending: 0,
  };
  assert.deepEqual(checklistDone(all), { body_session: true, quests_today: true, two_domains: true });
  // pending dailies block "complete today's quests"; two logs in one domain are one domain
  const part = { logs: [{ domain: "BODY" }, { domain: "BODY" }], questsCompletedToday: 1, dailiesPending: 1 };
  assert.deepEqual(checklistDone(part), { body_session: true, quests_today: false, two_domains: false });
});

test("home constants", () => {
  assert.equal(HOME_SESSIONS_TO_UNLOCK, 6);
  assert.deepEqual([...HOME_LOG_TYPES], ["home_session", "floor_session"]);
});
