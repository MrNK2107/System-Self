import assert from "node:assert/strict";
import { test } from "node:test";
import { OnboardingRequestSchema } from "@workspace/contracts";
import { DEFAULT_MORNING_TIME, DEFAULT_NIGHTLY_TIME, buildOnboardingPayload, draftFromParams, type OnboardingDraft } from "./payload";
import {
  MORNING_PRESETS,
  NIGHTLY_PRESETS,
  TOTAL_STEPS,
  completeRatings,
  isHHMM,
  nextUnrated,
  objectiveHint,
  ratedCount,
  ratingsHint,
  stepNumber,
  weaknessHint,
} from "./steps";

test("steps: six numbered steps, schedule last", () => {
  assert.equal(TOTAL_STEPS, 6);
  assert.equal(stepNumber("rate"), 1);
  assert.equal(stepNumber("schedule"), 6);
});

test("ratings start unset: CONTINUE stays locked with the right hint until all five are rated", () => {
  assert.equal(ratedCount({}), 0);
  assert.equal(completeRatings({}), null);
  assert.equal(ratingsHint({}), "Rate every domain. 0 of 5 rated.");
  const partial = { BODY: 3, MIND: 7 };
  assert.equal(ratingsHint(partial), "Rate every domain. 2 of 5 rated.");
  assert.equal(completeRatings(partial), null);
  const full = { BODY: 3, MIND: 7, WEALTH: 1, SOCIAL: 10, DISCIPLINE: 5 };
  assert.equal(ratingsHint(full), null);
  assert.deepEqual(completeRatings(full), full);
  // Out-of-range or non-integer values do not count as rated.
  assert.equal(ratedCount({ BODY: 0, MIND: 11, WEALTH: 2.5 }), 0);
});

test("nextUnrated walks forward from the domain just rated and wraps", () => {
  assert.equal(nextUnrated({}), "BODY");
  assert.equal(nextUnrated({ BODY: 4 }, "BODY"), "MIND");
  assert.equal(nextUnrated({ BODY: 4, DISCIPLINE: 2 }, "DISCIPLINE"), "MIND");
  assert.equal(nextUnrated({ BODY: 1, MIND: 1, WEALTH: 1, SOCIAL: 1, DISCIPLINE: 1 }, "SOCIAL"), null);
});

test("objective and weakness hints describe what is missing", () => {
  assert.equal(objectiveHint(""), "Pick an objective or write your own.");
  assert.equal(objectiveHint("  run "), "Write at least 5 characters.");
  assert.equal(objectiveHint("Run 5km"), null);
  assert.equal(weaknessHint(null), "Pick the domain that held you back most.");
  assert.equal(weaknessHint("BODY"), null);
});

test("schedule presets are valid HH:MM, sorted, and include the defaults", () => {
  for (const list of [MORNING_PRESETS, NIGHTLY_PRESETS]) {
    assert.ok(list.every(isHHMM));
    assert.deepEqual([...list].sort(), [...list]);
  }
  assert.ok((MORNING_PRESETS as readonly string[]).includes(DEFAULT_MORNING_TIME));
  assert.ok((NIGHTLY_PRESETS as readonly string[]).includes(DEFAULT_NIGHTLY_TIME));
  assert.equal(isHHMM("24:00"), false);
  assert.equal(isHHMM("7:00"), false);
});

const draft: OnboardingDraft = {
  ratings: { BODY: 5, MIND: 6, WEALTH: 4, SOCIAL: 7, DISCIPLINE: 3 },
  primaryGoal: "Run 5km without stopping",
  weakness: "BODY",
  stoppedBefore: "",
  identity: "semi-public",
  timezone: "UTC",
};

test("payload: the schedule step's times are sent with onboarding; bad or missing ones fall back to the defaults", () => {
  const p = buildOnboardingPayload({ ...draft, morningTime: "05:30", nightlyTime: "22:30" });
  assert.equal(p.morningTime, "05:30");
  assert.equal(p.nightlyTime, "22:30");
  assert.equal(OnboardingRequestSchema.safeParse(p).success, true);
  const bad = buildOnboardingPayload({ ...draft, morningTime: "25:00" });
  assert.equal(bad.morningTime, DEFAULT_MORNING_TIME);
  assert.equal(bad.nightlyTime, DEFAULT_NIGHTLY_TIME);

  const params = { ratings: JSON.stringify(draft.ratings), primaryGoal: draft.primaryGoal, weakness: "BODY", identity: "public" };
  const d = draftFromParams({ ...params, morningTime: "06:00", nightlyTime: "21:30" }, "UTC")!;
  assert.equal(d.morningTime, "06:00");
  assert.equal(d.nightlyTime, "21:30");
  const junk = draftFromParams({ ...params, morningTime: "soon" }, "UTC")!;
  assert.equal(junk.morningTime, undefined);
  assert.equal(buildOnboardingPayload(junk).morningTime, DEFAULT_MORNING_TIME);
});
