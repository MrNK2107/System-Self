import test from "node:test";
import assert from "node:assert/strict";
import { THEMES, TYPEWRITER_MS, resolveUiState } from "./theme";

test("palettes match PRD section 17", () => {
  assert.deepEqual([THEMES.FALLING.background, THEMES.FALLING.accent], ["#0A0A0A", "#8B0000"]);
  assert.deepEqual([THEMES.STABLE.background, THEMES.STABLE.accent], ["#111318", "#3A7BD5"]);
  assert.deepEqual([THEMES.CLIMBING.background, THEMES.CLIMBING.accent], ["#0D1B2A", "#00D4FF"]);
  assert.deepEqual([THEMES.PEAK.background, THEMES.PEAK.accent], ["#0A0E17", "#E8D5A3"]);
});

test("only PEAK has the grid texture", () => {
  assert.deepEqual(
    Object.entries(THEMES).filter(([, t]) => t.grid).map(([k]) => k),
    ["PEAK"],
  );
});

test("typewriter speeds per state", () => {
  assert.deepEqual(TYPEWRITER_MS, { FALLING: 45, STABLE: 25, CLIMBING: 18, PEAK: 20 });
});

test("resolveUiState falls back to STABLE", () => {
  assert.equal(resolveUiState(undefined), "STABLE");
  assert.equal(resolveUiState("nope"), "STABLE");
  assert.equal(resolveUiState(null), "STABLE");
  assert.equal(resolveUiState("PEAK"), "PEAK");
});
