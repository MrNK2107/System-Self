import test from "node:test";
import assert from "node:assert/strict";
import { LIFE_CONTEXTS, SEASON_LINES, SEASON_PROMPT_LINE, earliestSeasonStart, lifeContext, validateSeason } from "./life";

const TODAY = "2026-06-08";
const ctx = (lifeContext: Parameters<typeof validateSeason>[1]["lifeContext"], existing: { startsOn: string; endsOn: string }[] = []) => ({
  today: TODAY,
  lifeContext,
  existing,
});

test("contexts and season lines are fixed", () => {
  assert.deepEqual(LIFE_CONTEXTS.map((c) => c.key), ["student", "professional", "shift_worker", "athlete", "founder", "parent", "traveling"]);
  assert.equal(lifeContext("student").promptLine, "Fit quests into gaps between classes. Prefer 20–45 minute blocks.");
  assert.equal(lifeContext("traveling").promptLine, "No gym access assumed. Bodyweight or hotel-room sessions only.");
  assert.equal(SEASON_LINES.away, "Away Mode. No gym. No excuse.");
  assert.equal(SEASON_LINES.competition, "Competition Week. Taper. The standard does not drop.");
  assert.match(SEASON_PROMPT_LINE, /Same count of quests\.$/);
});

test("validateSeason accepts a valid season and computes the end", () => {
  assert.deepEqual(validateSeason({ kind: "exam", startsOn: "2026-06-09", lengthDays: 7 }, ctx("student")), { ok: true, endsOn: "2026-06-15" });
  assert.deepEqual(validateSeason({ kind: "away", startsOn: "2026-06-09", lengthDays: 1 }, ctx("professional")), { ok: true, endsOn: "2026-06-09" });
  assert.deepEqual(validateSeason({ kind: "away", startsOn: "2026-06-20", lengthDays: 14 }, ctx("parent")), { ok: true, endsOn: "2026-07-03" });
});

test("validateSeason rejects start today, length 15, overlap, cooldown < 7 days, exam for a professional", () => {
  const bad = (r: unknown, code: string) => assert.deepEqual(r, { ok: false, code });
  bad(validateSeason({ kind: "exam", startsOn: TODAY, lengthDays: 3 }, ctx("student")), "invalid_dates");
  bad(validateSeason({ kind: "exam", startsOn: "2026-06-01", lengthDays: 3 }, ctx("student")), "invalid_dates");
  bad(validateSeason({ kind: "exam", startsOn: "2026-06-09", lengthDays: 15 }, ctx("student")), "invalid_dates");
  bad(validateSeason({ kind: "exam", startsOn: "2026-06-09", lengthDays: 0 }, ctx("student")), "invalid_dates");
  bad(validateSeason({ kind: "exam", startsOn: "2026-06-09", lengthDays: 2.5 }, ctx("student")), "invalid_dates");
  bad(validateSeason({ kind: "exam", startsOn: "June 9", lengthDays: 3 }, ctx("student")), "invalid_dates");
  bad(validateSeason({ kind: "exam", startsOn: "2026-06-09", lengthDays: 3 }, ctx("professional")), "invalid_kind");
  bad(validateSeason({ kind: "nonsense", startsOn: "2026-06-09", lengthDays: 3 }, ctx("student")), "invalid_kind");
  // Overlap with a scheduled season, and with an active one.
  bad(validateSeason({ kind: "exam", startsOn: "2026-06-12", lengthDays: 3 }, ctx("student", [{ startsOn: "2026-06-10", endsOn: "2026-06-14" }])), "season_conflict");
  bad(validateSeason({ kind: "exam", startsOn: "2026-06-30", lengthDays: 3 }, ctx("student", [{ startsOn: "2026-06-05", endsOn: "2026-06-10" }])), "season_conflict");
  // Cooldown: previous ended 2026-06-07; start must be >= end + 8 = 2026-06-15.
  const prev = [{ startsOn: "2026-06-01", endsOn: "2026-06-07" }];
  bad(validateSeason({ kind: "exam", startsOn: "2026-06-14", lengthDays: 3 }, ctx("student", prev)), "season_conflict");
  assert.deepEqual(validateSeason({ kind: "exam", startsOn: "2026-06-15", lengthDays: 3 }, ctx("student", prev)), { ok: true, endsOn: "2026-06-17" });
});

test("earliestSeasonStart is tomorrow, or the day the cooldown after the last season clears", () => {
  assert.equal(earliestSeasonStart("2026-06-08", []), "2026-06-09");
  assert.equal(earliestSeasonStart("2026-06-08", [{ endsOn: "2026-06-07" }]), "2026-06-15");
  assert.equal(earliestSeasonStart("2026-06-08", [{ endsOn: "2026-01-01" }, { endsOn: "2026-06-10" }]), "2026-06-18");
  assert.equal(earliestSeasonStart("2026-06-08", [{ endsOn: "2026-05-01" }]), "2026-06-09");
});

test("every life context has user-facing copy that is not the model prompt", () => {
  for (const c of LIFE_CONTEXTS) {
    assert.ok(c.blurb.length > 0, c.key);
    assert.notEqual(c.blurb, c.promptLine, c.key);
    assert.doesNotMatch(c.blurb, /\bthe user\b/i, c.key);
  }
});
