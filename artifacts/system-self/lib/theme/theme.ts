// Adaptive UI palette and typewriter pace per uiState (PRD section 17). Pure; no React Native imports.
// Presentational only: nothing here feeds a score or a rule.
import type { UiState } from "@workspace/contracts";

export interface ThemeTokens {
  background: string;
  /** PRD accent: for fills, borders and the grid. */
  accent: string;
  /** Accent for text and icons on `background` (>= 4.5:1 contrast). Equals `accent` where that already passes. */
  accentText: string;
  /** Readable text colour on top of `accent`. */
  onAccent: string;
  /** Draw the subtle grid texture behind the screen. */
  grid: boolean;
}

// Shadow Monarch family (owner decision 2026-10-20; the PRD's four states, recoloured): falling bleeds to crimson,
// stable is monarch violet, climbing brightens it, peak turns white-gold.
export const THEMES: Record<UiState, ThemeTokens> = {
  FALLING: { background: "#080506", accent: "#B3263A", accentText: "#F06A78", onAccent: "#FFFFFF", grid: false },
  STABLE: { background: "#07060B", accent: "#A879FF", accentText: "#B48CFF", onAccent: "#0B0812", grid: false },
  CLIMBING: { background: "#06050D", accent: "#C4A2FF", accentText: "#CDB0FF", onAccent: "#0B0812", grid: false },
  PEAK: { background: "#0A0907", accent: "#E8D5A3", accentText: "#E8D5A3", onAccent: "#0A0907", grid: true },
};

/** SYSTEM text typewriter delay per character, in ms. */
export const TYPEWRITER_MS: Record<UiState, number> = { FALLING: 45, STABLE: 25, CLIMBING: 18, PEAK: 20 };

const STATES = Object.keys(THEMES) as UiState[];

/** The state to render with: the server's value when it is one we know, else STABLE (loading, stale cache). */
export function resolveUiState(value: unknown): UiState {
  return typeof value === "string" && (STATES as string[]).includes(value) ? (value as UiState) : "STABLE";
}
