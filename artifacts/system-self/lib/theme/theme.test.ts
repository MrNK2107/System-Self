import test from "node:test";
import assert from "node:assert/strict";
import { THEMES, TYPEWRITER_MS, resolveUiState } from "./theme";

test("palettes are the Shadow Monarch recolouring of the PRD's four states", () => {
  assert.deepEqual([THEMES.FALLING.background, THEMES.FALLING.accent], ["#080506", "#B3263A"]);
  assert.deepEqual([THEMES.STABLE.background, THEMES.STABLE.accent], ["#07060B", "#A879FF"]);
  assert.deepEqual([THEMES.CLIMBING.background, THEMES.CLIMBING.accent], ["#06050D", "#C4A2FF"]);
  assert.deepEqual([THEMES.PEAK.background, THEMES.PEAK.accent], ["#0A0907", "#E8D5A3"]);
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

/** WCAG 2.x contrast ratio between two #RRGGBB colours. */
function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

test("accentText is readable (>= 4.5:1) on every state's background", () => {
  for (const [state, t] of Object.entries(THEMES)) {
    assert.ok(t.accentText, `${state} has accentText`);
    const ratio = contrast(t.accentText, t.background);
    assert.ok(ratio >= 4.5, `${state}: ${t.accentText} on ${t.background} = ${ratio.toFixed(2)}`);
  }
});

test("onAccent label is readable (>= 4.5:1) on every state's accent fill", () => {
  for (const [state, t] of Object.entries(THEMES)) {
    const ratio = contrast(t.onAccent, t.accent);
    assert.ok(ratio >= 4.5, `${state}: ${t.onAccent} on ${t.accent} = ${ratio.toFixed(2)}`);
  }
});

test("every text token in constants/colors is readable (>= 4.5:1) on the background and on cards", async () => {
  const { default: colors } = await import("../../constants/colors");
  const p = colors.light;
  const texts = { foreground: p.foreground, mutedForeground: p.mutedForeground, subtle: p.subtle, primary: p.primary, destructive: p.destructive, warn: p.warn, success: p.success };
  for (const [name, c] of Object.entries(texts)) {
    for (const bg of [p.background, p.card]) {
      const ratio = contrast(c, bg);
      assert.ok(ratio >= 4.5, `${name} ${c} on ${bg} = ${ratio.toFixed(2)}`);
    }
  }
});
