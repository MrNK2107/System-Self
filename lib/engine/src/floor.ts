/**
 * Floor Quest routines: short bodyweight sessions offered when a BODY quest is refused. A floor session is
 * not a quest; it is logged as an ordinary BODY log (`floor_session`) and scores like any other BODY log.
 */
export interface FloorStep {
  name: string;
  seconds: number;
}

export interface FloorRoutine {
  id: string;
  title: string;
  /** Total length in whole minutes (the steps add up to it). */
  minutes: number;
  steps: FloorStep[];
}

function routine(
  id: string,
  title: string,
  moves: string[],
  rounds: number,
  workSeconds: number,
  restSeconds: number,
): FloorRoutine {
  const steps: FloorStep[] = [{ name: "Warm-up: march in place, arm circles", seconds: 60 }];
  for (let r = 1; r <= rounds; r++) {
    for (const move of moves) {
      steps.push({ name: `${move} (round ${r})`, seconds: workSeconds });
      steps.push({ name: "Rest", seconds: restSeconds });
    }
  }
  steps.push({ name: "Cool-down: stretch hamstrings, chest, shoulders", seconds: 60 });
  const total = steps.reduce((s, x) => s + x.seconds, 0);
  return { id, title, minutes: Math.round(total / 60), steps };
}

export const FLOOR_ROUTINES: FloorRoutine[] = [
  routine("push_floor", "PUSH FLOOR", ["Push-ups", "Pike push-ups", "Bench dips on a chair"], 3, 45, 30),
  routine("legs_floor", "LEGS FLOOR", ["Squats", "Reverse lunges", "Glute bridges"], 3, 45, 30),
  routine("core_floor", "CORE FLOOR", ["Plank", "Dead bugs", "Mountain climbers"], 3, 40, 20),
  routine("burn_floor", "BURN FLOOR", ["Jumping jacks", "Squat jumps", "Burpees", "High knees"], 3, 40, 20),
  routine("full_floor", "FULL BODY FLOOR", ["Squats", "Push-ups", "Superman holds", "Plank"], 3, 40, 25),
  routine("pull_floor", "BACK AND HIPS FLOOR", ["Superman holds", "Prone Y raises", "Glute bridges", "Bird dogs"], 3, 40, 25),
];

/** Deterministic pick by seed (the refused quest id), so the same quest always gets the same routine. */
export function pickFloorRoutine(seed: string): FloorRoutine {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return FLOOR_ROUTINES[h % FLOOR_ROUTINES.length]!;
}
