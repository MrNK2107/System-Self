import type { Rank } from "./constants";

/** Presentational adaptive-UI state. Never an input to any score, rank or decay rule. */
export const UI_STATES = ["FALLING", "STABLE", "CLIMBING", "PEAK"] as const;
export type UiState = (typeof UI_STATES)[number];

/**
 * The adaptive UI state, rules checked in order: FALLING (shadow active and trajectory down), PEAK (rank A or S and
 * trajectory up), CLIMBING (trajectory up), else STABLE. The entitlement gate (free = STABLE) lives in the caller.
 */
export function uiState(input: {
  shadowActive: boolean;
  trajectory: "up" | "stable" | "down";
  rank: Rank;
}): UiState {
  if (input.shadowActive && input.trajectory === "down") return "FALLING";
  if ((input.rank === "A" || input.rank === "S") && input.trajectory === "up") return "PEAK";
  if (input.trajectory === "up") return "CLIMBING";
  return "STABLE";
}
