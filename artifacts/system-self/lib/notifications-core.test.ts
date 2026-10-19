import assert from "node:assert/strict";
import { test } from "node:test";
import {
  NIGHTLY_BODY,
  PERMISSION_EXPLANATION,
  SCHEDULE_DAYS,
  morningBody,
  ourScheduledIds,
  parseClock,
  permissionAction,
  planReminders,
  pushRegistrationDecision,
  reminderId,
} from "./notifications-core";

const base = {
  timezone: "Asia/Kolkata",
  morningTime: "06:30",
  nightlyTime: "21:30",
  morning: true,
  nightly: true,
};
// 05:30 local on 2026-10-19 in Asia/Kolkata; that day is Day 9.
const NOW = new Date("2026-10-19T00:00:00Z");
const anchor = { date: "2026-10-19", dayNumber: 9 };

test("copy is verbatim", () => {
  assert.equal(PERMISSION_EXPLANATION, "THE SYSTEM speaks twice a day. Allow it.");
  assert.equal(morningBody(9), "SYSTEM // SELF — Day 9. Your briefing is ready.");
  assert.equal(NIGHTLY_BODY, "The day is over. Your verdict is waiting.");
});

test("parseClock accepts HH:MM only", () => {
  assert.deepEqual(parseClock("06:30"), { hour: 6, minute: 30 });
  assert.deepEqual(parseClock("23:59"), { hour: 23, minute: 59 });
  for (const bad of ["", "6:30", "24:00", "12:60", "ab:cd", "06:30:00"]) assert.equal(parseClock(bad), null, bad);
});

test("plans both reminders for the next days at the user's local times, with the right day numbers", () => {
  const plan = planReminders({ ...base, now: NOW, anchor });
  assert.equal(plan.length, SCHEDULE_DAYS * 2);
  const first = plan[0]!;
  assert.equal(first.kind, "morning");
  assert.equal(first.at.toISOString(), "2026-10-19T01:00:00.000Z"); // 06:30 IST
  assert.equal(first.body, "SYSTEM // SELF — Day 9. Your briefing is ready.");
  assert.equal(first.id, reminderId("morning", "2026-10-19"));
  const nightly = plan.find((p) => p.kind === "nightly")!;
  assert.equal(nightly.at.toISOString(), "2026-10-19T16:00:00.000Z"); // 21:30 IST
  assert.equal(nightly.body, NIGHTLY_BODY);
  const second = plan.filter((p) => p.kind === "morning")[1]!;
  assert.equal(second.body, "SYSTEM // SELF — Day 10. Your briefing is ready.");
  assert.ok(plan.every((p, i) => i === 0 || p.at.getTime() >= plan[i - 1]!.at.getTime()));
  assert.equal(new Set(plan.map((p) => p.id)).size, plan.length);
});

test("a time that has already passed today starts tomorrow", () => {
  const late = new Date("2026-10-19T02:00:00Z"); // 07:30 IST: morning 06:30 is past
  const plan = planReminders({ ...base, now: late, anchor });
  const morning = plan.filter((p) => p.kind === "morning");
  assert.equal(morning[0]!.at.toISOString(), "2026-10-20T01:00:00.000Z");
  assert.equal(morning[0]!.body, "SYSTEM // SELF — Day 10. Your briefing is ready.");
  assert.equal(plan.filter((p) => p.kind === "nightly")[0]!.at.toISOString(), "2026-10-19T16:00:00.000Z");
});

test("prefs off remove that reminder only; both off schedules nothing", () => {
  const onlyNightly = planReminders({ ...base, morning: false, now: NOW, anchor });
  assert.ok(onlyNightly.length > 0 && onlyNightly.every((p) => p.kind === "nightly"));
  const onlyMorning = planReminders({ ...base, nightly: false, now: NOW, anchor });
  assert.ok(onlyMorning.length > 0 && onlyMorning.every((p) => p.kind === "morning"));
  assert.deepEqual(planReminders({ ...base, morning: false, nightly: false, now: NOW, anchor }), []);
});

test("an unparseable time skips that reminder instead of throwing", () => {
  const plan = planReminders({ ...base, morningTime: "nope", now: NOW, anchor });
  assert.ok(plan.every((p) => p.kind === "nightly"));
});

test("local times hold across a DST change", () => {
  // US clocks go back on 2026-11-01: 07:00 local is 11:00Z before and 12:00Z after.
  const plan = planReminders({
    ...base,
    timezone: "America/New_York",
    morningTime: "07:00",
    nightly: false,
    now: new Date("2026-10-30T00:00:00Z"),
    anchor: { date: "2026-10-29", dayNumber: 1 },
  });
  const at = (date: string) => plan.find((p) => p.id === reminderId("morning", date))!.at.toISOString();
  assert.equal(at("2026-10-31"), "2026-10-31T11:00:00.000Z");
  assert.equal(at("2026-11-02"), "2026-11-02T12:00:00.000Z");
});

test("only our own scheduled ids are cancelled", () => {
  const scheduled = [
    { identifier: reminderId("morning", "2026-10-19") },
    { identifier: "someone-elses-reminder" },
    { identifier: reminderId("nightly", "2026-10-19") },
    { identifier: "" },
  ];
  assert.deepEqual(ourScheduledIds(scheduled), [reminderId("morning", "2026-10-19"), reminderId("nightly", "2026-10-19")]);
});

test("permission flow: explain once, never re-ask after a denial, offer OS settings", () => {
  assert.equal(permissionAction({ status: "undetermined", canAskAgain: true, alreadyPrompted: false }), "explain");
  assert.equal(permissionAction({ status: "undetermined", canAskAgain: true, alreadyPrompted: true }), "none");
  assert.equal(permissionAction({ status: "granted", canAskAgain: true, alreadyPrompted: false }), "none");
  assert.equal(permissionAction({ status: "denied", canAskAgain: false, alreadyPrompted: true }), "settings");
  assert.equal(permissionAction({ status: "denied", canAskAgain: true, alreadyPrompted: true }), "settings");
  assert.equal(permissionAction({ status: "denied", canAskAgain: true, alreadyPrompted: false }), "settings");
});

test("push token registration: never on Expo Go Android, needs an EAS project id on iOS Expo Go and a real device", () => {
  const ok = { executionEnvironment: "standalone", platform: "android", isDevice: true, projectId: "p-1" };
  assert.deepEqual(pushRegistrationDecision(ok), { register: true, projectId: "p-1" });
  assert.deepEqual(pushRegistrationDecision({ ...ok, platform: "ios" }), { register: true, projectId: "p-1" });
  assert.deepEqual(pushRegistrationDecision({ ...ok, executionEnvironment: "storeClient" }), { register: false, reason: "expo_go_android" });
  assert.deepEqual(pushRegistrationDecision({ ...ok, executionEnvironment: "storeClient", platform: "ios" }), { register: true, projectId: "p-1" });
  assert.deepEqual(pushRegistrationDecision({ ...ok, executionEnvironment: "storeClient", platform: "ios", projectId: undefined }), {
    register: false,
    reason: "no_project_id",
  });
  assert.deepEqual(pushRegistrationDecision({ ...ok, projectId: "" }), { register: false, reason: "no_project_id" });
  assert.deepEqual(pushRegistrationDecision({ ...ok, isDevice: false }), { register: false, reason: "not_a_device" });
  assert.deepEqual(pushRegistrationDecision({ ...ok, platform: "web" }), { register: false, reason: "unsupported_platform" });
});
