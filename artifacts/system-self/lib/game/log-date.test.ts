import assert from "node:assert/strict";
import { test } from "node:test";
import { localDate } from "@workspace/engine";
import { FREE_DAYS_BACK, PRO_DAYS_BACK, dayOptions } from "./log-date";
import { buildLogRequest } from "./actions";

const NOW = new Date("2026-03-10T08:00:00Z"); // Tue 13:30 in Asia/Kolkata
const TZ = "Asia/Kolkata";
const H = 3600_000;

test("dayOptions lists today first, 30 days back, labelled in the account timezone", () => {
  const o = dayOptions(NOW, TZ, true);
  assert.equal(o.length, PRO_DAYS_BACK + 1);
  assert.deepEqual(o.slice(0, 4).map((d) => d.label), ["Today", "Yesterday", "Sun 8 Mar", "Sat 7 Mar"]);
  assert.equal(o[0]!.date, "2026-03-10");
  assert.equal(o[30]!.date, "2026-02-08");
  // 00:30 in Kolkata is still the previous day in UTC: the account timezone decides "today".
  assert.equal(dayOptions(new Date("2026-03-09T19:00:00Z"), TZ, true)[0]!.date, "2026-03-10");
});

test("free users are locked beyond 2 days back, PRO users are not", () => {
  const free = dayOptions(NOW, TZ, false);
  assert.deepEqual(free.map((d) => d.locked), free.map((d) => d.daysBack > FREE_DAYS_BACK));
  assert.equal(free[2]!.locked, false);
  assert.equal(free[3]!.locked, true);
  assert.ok(dayOptions(NOW, TZ, true).every((d) => !d.locked));
});

test("a past day is sent as 23:59:00 local on that day; today is now", () => {
  const o = dayOptions(NOW, TZ, true);
  assert.equal(o[0]!.occurredAt, NOW.toISOString());
  assert.equal(o[1]!.occurredAt, "2026-03-09T18:29:00.000Z"); // 23:59 IST on the 9th
  assert.equal(o[3]!.occurredAt, "2026-03-07T18:29:00.000Z");
});

test("at 23:57 local the free 2-days-back option is hidden, not misdated", () => {
  const now = new Date("2026-03-10T18:27:00Z"); // 23:57 IST
  const free = dayOptions(now, TZ, false);
  assert.equal(free[1]!.offered, true);
  assert.equal(free[2]!.offered, false); // 23:59 two days ago is 47 h 58 min back: inside 48 h by under 1 h
  const hours = (now.getTime() - Date.parse(free[1]!.occurredAt)) / H;
  assert.ok(hours < 47);
  // an hour later in the day it is offered again (00:30 next day: day 2 is now 24 h 31 min back)
  assert.equal(dayOptions(new Date("2026-03-10T19:00:00Z"), TZ, false)[2]!.offered, true);
});

test("PRO day 30 is offered only when its timestamp is 1 hour inside 30 days", () => {
  const early = dayOptions(new Date("2026-03-10T08:00:00Z"), TZ, true)[30]!; // 13:30: 23:59 on day 30 is 29 d 13.5 h back
  assert.equal(early.offered, true);
  const late = dayOptions(new Date("2026-03-10T18:27:00Z"), TZ, true)[30]!; // 23:57: 29 d 23 h 58 min back
  assert.equal(late.offered, false);
  assert.ok(dayOptions(NOW, TZ, true).slice(0, 30).every((d) => d.offered));
});

test("every offered option is inside the window and its date is the label's date, across timezones and DST", () => {
  const zones = ["Asia/Kolkata", "America/New_York", "Europe/London", "Australia/Sydney", "Pacific/Auckland"];
  const starts = [Date.parse("2026-03-01T00:00:00Z"), Date.parse("2026-10-20T00:00:00Z")]; // spans US/EU/AU/NZ transitions
  for (const zone of zones) {
    for (const start of starts) {
      for (let h = 0; h < 24 * 14; h += 7) {
        const now = new Date(start + h * H + 17 * 60_000);
        for (const pro of [false, true]) {
          const opts = dayOptions(now, zone, pro);
          for (const d of opts) {
            assert.equal(localDate(new Date(d.occurredAt), zone), d.date, `${zone} ${now.toISOString()} day ${d.daysBack}`);
            assert.ok(new Date(d.occurredAt).getTime() <= now.getTime());
            if (d.offered) {
              const limit = (pro ? 30 : 2) * 24 * H;
              assert.ok(now.getTime() - Date.parse(d.occurredAt) <= limit - H, `${zone} ${now.toISOString()} day ${d.daysBack} inside window`);
            }
          }
        }
      }
    }
  }
});

test("a DST-observing zone: the day before the spring-forward is dated correctly", () => {
  const now = new Date("2026-03-09T15:00:00Z"); // New York, the day after the 8 March transition (11:00 EDT)
  const o = dayOptions(now, "America/New_York", true);
  assert.equal(o[1]!.date, "2026-03-08");
  assert.equal(o[1]!.occurredAt, "2026-03-09T03:59:00.000Z"); // 23:59 EDT
  assert.equal(o[2]!.occurredAt, "2026-03-08T04:59:00.000Z"); // 23:59 EST on the 7th
});

test("a log built for a chosen day sends that occurredAt; the default stays now", () => {
  const at = dayOptions(NOW, TZ, false)[1]!.occurredAt;
  assert.equal((buildLogRequest({ domain: "BODY", type: "generic", occurredAt: at }, "c1", NOW).body as { occurredAt: string }).occurredAt, at);
  assert.equal((buildLogRequest({ domain: "BODY", type: "generic" }, "c2", NOW).body as { occurredAt: string }).occurredAt, NOW.toISOString());
});
