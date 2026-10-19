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

export const THEMES: Record<UiState, ThemeTokens> = {
  FALLING: { background: "#0A0A0A", accent: "#8B0000", accentText: "#E05555", onAccent: "#FFFFFF", grid: false },
  STABLE: { background: "#111318", accent: "#3A7BD5", accentText: "#4D8CE0", onAccent: "#FFFFFF", grid: false },
  CLIMBING: { background: "#0D1B2A", accent: "#00D4FF", accentText: "#00D4FF", onAccent: "#04121C", grid: false },
  PEAK: { background: "#0A0E17", accent: "#E8D5A3", accentText: "#E8D5A3", onAccent: "#0A0E17", grid: true },
};

/** SYSTEM text typewriter delay per character, in ms. */
export const TYPEWRITER_MS: Record<UiState, number> = { FALLING: 45, STABLE: 25, CLIMBING: 18, PEAK: 20 };

const STATES = Object.keys(THEMES) as UiState[];

/** The state to render with: the server's value when it is one we know, else STABLE (loading, stale cache). */
export function resolveUiState(value: unknown): UiState {
  return typeof value === "string" && (STATES as string[]).includes(value) ? (value as UiState) : "STABLE";
}
