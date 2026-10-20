import assert from "node:assert/strict";
import { test } from "node:test";
import { gapFromUser, gapLine, pastSelfGap, rivalsFeed, shadowGap, signed, standingLine } from "./arena";

const flat = (n: number) => ({ BODY: n, MIND: n, WEALTH: n, SOCIAL: n, DISCIPLINE: n });

test("rivalsFeed: LIVE only with a real rival, SIMULATED when every rival is a ghost, nothing when empty", () => {
  assert.equal(rivalsFeed([]), null);
  assert.equal(rivalsFeed([{ isGhost: true }, { isGhost: true }]), "SIMULATED");
  assert.equal(rivalsFeed([{ isGhost: true }, { isGhost: false }]), "LIVE");
});

test("gapFromUser: tone follows meaning (lead / trail), never the raw sign of the rival's delta", () => {
  assert.deepEqual(gapFromUser(25, 20), { value: 5, tone: "lead", label: "+5.0" });
  assert.deepEqual(gapFromUser(20, 22.3), { value: -2.3, tone: "trail", label: "-2.3" });
  assert.deepEqual(gapFromUser(20, 20.04), { value: 0, tone: "level", label: "0.0" });
  assert.equal(signed(-0.04), "0.0");
});

test("gapLine and standingLine read in plain words", () => {
  assert.equal(gapLine(gapFromUser(20, 22.1)), "You trail by 2.1.");
  assert.equal(gapLine(gapFromUser(24, 22)), "You lead by 2.0.");
  assert.equal(gapLine(gapFromUser(1, 1)), "Level.");
  assert.equal(standingLine(1, 1), "No one to rank against yet.");
  assert.equal(standingLine(1, 4), "You lead. 3 behind you.");
  assert.equal(standingLine(2, 4), "#2 of 4. 1 ahead of you.");
  assert.equal(standingLine(4, 4), "Last of 4. Everyone is ahead.");
});

test("pastSelfGap: one line instead of five baseline -> current rows", () => {
  assert.equal(pastSelfGap({ label: "DAY 1", baseline: flat(20), current: flat(20) }).line, "No change since DAY 1.");
  const up = pastSelfGap({ label: "DAY 1", baseline: flat(20), current: { ...flat(20), BODY: 27 } });
  assert.equal(up.tone, "lead");
  assert.equal(up.line, "Up 1.4 on average since DAY 1.");
  assert.equal(pastSelfGap({ label: "SINCE 2026-09-01", baseline: flat(20), current: flat(19) }).line, "Down 1.0 on average since 2026-09-01.");
});

test("shadowGap: trailing the shadow is the destructive tone and counts lost domains", () => {
  const g = shadowGap({ ...flat(22), MIND: 18 }, flat(20));
  assert.equal(g.tone, "trail");
  assert.equal(g.domainsLost, 4);
  assert.equal(g.line, "Ahead of you by 1.2. Holds 4 of 5 domains.");
  assert.equal(shadowGap(flat(18), flat(20)).line, "You lead it by 2.0.");
});
