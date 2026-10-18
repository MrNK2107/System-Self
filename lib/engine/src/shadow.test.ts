import { test } from "node:test";
import assert from "node:assert/strict";
import {
  initShadow,
  isShadowResolved,
  shadowGap,
  shadowPhase,
  shadowRank,
  shadowScores,
  shouldActivateShadow,
  SHADOW_HEAD_START,
} from "./shadow";
import type { RankedDomain } from "./constants";

const T0 = new Date("2026-03-01T00:00:00.000Z");
const days = (n: number) => new Date(T0.getTime() + n * 86_400_000);
const scores = (v: number): Record<RankedDomain, number> => ({ BODY: v, MIND: v, WEALTH: v, SOCIAL: v, DISCIPLINE: v });

test("initShadow head start 12 capped at 100", () => {
  assert.equal(SHADOW_HEAD_START, 12);
  const s = initShadow({ BODY: 50, MIND: 95, WEALTH: 0, SOCIAL: 88, DISCIPLINE: 100 }, "neo", T0);
  assert.deepEqual(s.initialScores, { BODY: 62, MIND: 100, WEALTH: 12, SOCIAL: 100, DISCIPLINE: 100 });
  assert.equal(s.codename, "SHADOW // NEO");
  assert.equal(s.active, true);
  assert.equal(s.activatedAt, T0.toISOString());
  assert.deepEqual(s.gainRates, { BODY: 1.4, MIND: 1.2, WEALTH: 1.0, SOCIAL: 1.0, DISCIPLINE: 1.8 });
});

test("shadow BODY after 2 days = initial + 2.8", () => {
  const s = initShadow(scores(40), "a", T0);
  assert.ok(Math.abs(shadowScores(s, days(2)).BODY - 54.8) < 1e-9);
  assert.ok(Math.abs(shadowScores(s, days(0.5)).BODY - 52.7) < 1e-9);
  assert.equal(shadowScores(s, days(1000)).BODY, 100);
});

test("inactive shadow scores stay at initial", () => {
  const s = { ...initShadow(scores(40), "a", T0), active: false, activatedAt: null };
  assert.equal(shadowScores(s, days(5)).BODY, 52);
  assert.equal(shadowPhase(s, 50, days(5)), "DORMANT");
});

test("phase HUNTING at gap 12 day 1", () => {
  const s = initShadow(scores(40), "a", T0);
  assert.equal(shadowPhase(s, 12, days(1)), "HUNTING");
  assert.equal(shadowPhase(s, 4, days(1)), "AWAKENED");
  assert.equal(shadowPhase(s, 5, days(1)), "HUNTING");
  assert.equal(shadowPhase(s, 25, days(1)), "DOMINANT");
  assert.equal(shadowPhase(s, 10, days(14)), "DOMINANT");
});

test("shadowGap and shadowRank", () => {
  const s = initShadow(scores(40), "a", T0);
  assert.equal(shadowGap(s, scores(40), days(0)), 12);
  assert.equal(shadowRank(s, days(0)), "C"); // mean 52
});

const snaps = (hs: number[]) => hs.map((h, i) => ({ date: `d${i}`, hidden: h }));

test("shouldActivateShadow true after 7 below the trailing mean with >=14 snapshots; false with 13", () => {
  const h = [...Array(7).fill(60), ...Array(7).fill(40)];
  assert.equal(shouldActivateShadow(snaps(h), 0), true);
  assert.equal(shouldActivateShadow(snaps(h.slice(1)), 0), false); // 13 snapshots
});

test("shouldActivateShadow false when not all of the last 7 are below the trailing mean", () => {
  const h = [...Array(7).fill(60), ...Array(6).fill(40), 80];
  assert.equal(shouldActivateShadow(snaps(h), 0), false);
});

test("shouldActivateShadow true when inactiveDays >= 5", () => {
  assert.equal(shouldActivateShadow([], 5), true);
  assert.equal(shouldActivateShadow([], 4), false);
});

test("isShadowResolved only when every domain >= shadow", () => {
  const s = initShadow(scores(40), "a", T0);
  assert.equal(isShadowResolved(s, scores(52), days(0)), true);
  assert.equal(isShadowResolved(s, { ...scores(60), MIND: 51.9 }, days(0)), false);
  assert.equal(isShadowResolved({ ...s, active: false }, scores(100), days(0)), false);
});
