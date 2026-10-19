import test from "node:test";
import assert from "node:assert/strict";
import { UI_STATES, uiState, type UiState } from "./ui-state";

type Traj = "up" | "stable" | "down";
const RANKS = ["E", "D", "C", "B", "A", "S"] as const;
const TRAJ: Traj[] = ["up", "stable", "down"];

function expected(shadowActive: boolean, traj: Traj, rank: (typeof RANKS)[number]): UiState {
  if (shadowActive && traj === "down") return "FALLING";
  if ((rank === "A" || rank === "S") && traj === "up") return "PEAK";
  if (traj === "up") return "CLIMBING";
  return "STABLE";
}

test("uiState: full rule matrix", () => {
  for (const shadowActive of [true, false])
    for (const traj of TRAJ)
      for (const rank of RANKS)
        assert.equal(uiState({ shadowActive, trajectory: traj, rank }), expected(shadowActive, traj, rank), `${shadowActive}/${traj}/${rank}`);
});

test("uiState: rule order and spot checks", () => {
  assert.equal(uiState({ shadowActive: true, trajectory: "down", rank: "S" }), "FALLING");
  assert.equal(uiState({ shadowActive: true, trajectory: "up", rank: "S" }), "PEAK");
  assert.equal(uiState({ shadowActive: true, trajectory: "up", rank: "C" }), "CLIMBING");
  assert.equal(uiState({ shadowActive: false, trajectory: "down", rank: "A" }), "STABLE");
  assert.equal(uiState({ shadowActive: false, trajectory: "stable", rank: "A" }), "STABLE");
});

test("UI_STATES lists the four states", () => {
  assert.deepEqual([...UI_STATES], ["FALLING", "STABLE", "CLIMBING", "PEAK"]);
});
