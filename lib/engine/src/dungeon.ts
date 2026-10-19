import type { PlanBlockDef, Weekday } from "./gym";

/** If a machine is taken: the seeded exercises to do instead (1-2 each, all themselves seeded). */
export const EXERCISE_FALLBACKS: Record<string, string[]> = {
  ex_squat: ["ex_goblet_squat", "ex_leg_press"],
  ex_bench: ["ex_db_press", "ex_pushup"],
  ex_deadlift: ["ex_rdl_db"],
  ex_ohp: ["ex_db_shoulder_press"],
  ex_row: ["ex_db_row", "ex_inverted_row"],
  ex_pullup: ["ex_lat_pulldown", "ex_inverted_row"],
  ex_lunge: ["ex_goblet_squat", "ex_bodyweight_squat"],
  ex_plank: ["ex_dead_bug"],
  ex_db_press: ["ex_pushup"],
  ex_goblet_squat: ["ex_bodyweight_squat", "ex_leg_press"],
  ex_lat_pulldown: ["ex_inverted_row", "ex_db_row"],
  ex_leg_press: ["ex_goblet_squat", "ex_bodyweight_squat"],
  ex_db_row: ["ex_inverted_row"],
  ex_pushup: ["ex_db_press"],
  ex_rdl_db: ["ex_glute_bridge"],
  ex_db_shoulder_press: ["ex_pushup"],
  ex_glute_bridge: ["ex_bodyweight_squat"],
  ex_bodyweight_squat: ["ex_goblet_squat"],
  ex_inverted_row: ["ex_db_row"],
  ex_dead_bug: ["ex_plank"],
};

/** One line (max 120 chars) on how to do each exercise. */
export const EXERCISE_HOWTO: Record<string, string> = {
  ex_squat: "Bar on upper back, feet shoulder width. Sit between your hips, chest up, drive up through mid-foot.",
  ex_bench: "Shoulder blades pinched, feet flat. Lower the bar to mid-chest, press straight up.",
  ex_deadlift: "Bar over mid-foot, flat back. Push the floor away, lock hips and knees together.",
  ex_ohp: "Bar at collarbone, glutes tight. Press overhead, head through at the top.",
  ex_row: "Hinge to a flat back. Pull the bar to your lower ribs, squeeze, lower under control.",
  ex_pullup: "Hang from the bar, shoulders down. Pull until your chin clears it, lower fully.",
  ex_lunge: "Long step, back knee toward the floor, front heel down. Drive through and step again.",
  ex_plank: "Forearms down, body in one line. Ribs tucked, glutes tight, breathe.",
  ex_db_press: "Bench flat, dumbbells at chest level. Press up and slightly in, lower slowly.",
  ex_goblet_squat: "Hold one dumbbell at your chest. Elbows inside knees, sit deep, stand tall.",
  ex_lat_pulldown: "Grip wide, lean back slightly. Pull the bar to upper chest, elbows down.",
  ex_leg_press: "Feet shoulder width on the plate. Lower to 90 degrees at the knee, press without locking out.",
  ex_db_row: "Hand and knee on a bench. Pull the dumbbell to your hip, keep your back flat.",
  ex_pushup: "Hands under shoulders, body straight. Chest to the floor, press back up.",
  ex_rdl_db: "Soft knees, dumbbells down the thighs. Push hips back until hamstrings stretch, then stand.",
  ex_db_shoulder_press: "Seated or standing, dumbbells at shoulders. Press overhead, lower to ear height.",
  ex_glute_bridge: "On your back, knees bent. Drive hips up, squeeze glutes at the top, lower.",
  ex_bodyweight_squat: "Feet shoulder width, arms forward. Sit back and down, chest up, stand.",
  ex_inverted_row: "Lie under a low bar, body straight. Pull your chest to the bar, lower slowly.",
  ex_dead_bug: "On your back, arms up, knees at 90. Lower opposite arm and leg, back pressed down.",
};

/** Default day for a weekday the plan leaves empty: easy, mostly dumbbells, 4 exercises. */
export const BEGINNER_DAY: PlanBlockDef[] = [
  { exerciseId: "ex_goblet_squat", sets: 3, repRange: "8-12", restSec: 90 },
  { exerciseId: "ex_db_press", sets: 3, repRange: "8-12", restSec: 90 },
  { exerciseId: "ex_db_row", sets: 3, repRange: "8-12", restSec: 90 },
  { exerciseId: "ex_dead_bug", sets: 2, repRange: "10", restSec: 60 },
];

/** Plan blocks for that weekday when the plan has some, otherwise the beginner day. */
export function briefingBlocks(
  days: { weekday: string; blocks: PlanBlockDef[] }[],
  weekday: Weekday,
): { source: "plan" | "beginner"; blocks: PlanBlockDef[] } {
  const day = days.find((d) => d.weekday === weekday);
  if (day && day.blocks.length > 0) return { source: "plan", blocks: day.blocks };
  return { source: "beginner", blocks: BEGINNER_DAY };
}

/** Sum of sets x (45 s work + rest) in minutes, rounded. */
export function estimatedMinutes(blocks: PlanBlockDef[]): number {
  const seconds = blocks.reduce((s, b) => s + b.sets * (45 + b.restSec), 0);
  return Math.round(seconds / 60);
}

export type CrowdLevel = "quiet" | "normal" | "packed";

export const MIN_CROWD_REPORTS = 3;
const MAX_SUGGESTIONS = 3;

/**
 * Quiet-hour suggestions from the user's own scout reports. Needs MIN_CROWD_REPORTS reports; ranks
 * (weekday, hour) buckets by share of `quiet` (ties: fewer `packed`, then calendar order). A bucket with no
 * quiet report is never suggested.
 */
export function quietHours(reports: { weekday: number; hour: number; level: CrowdLevel }[]): {
  suggestions: { weekday: number; hour: number; quietShare: number }[];
  needed: number;
} {
  if (reports.length < MIN_CROWD_REPORTS) return { suggestions: [], needed: MIN_CROWD_REPORTS - reports.length };
  const buckets = new Map<string, { weekday: number; hour: number; n: number; quiet: number; packed: number }>();
  for (const r of reports) {
    const key = `${r.weekday}:${r.hour}`;
    const b = buckets.get(key) ?? { weekday: r.weekday, hour: r.hour, n: 0, quiet: 0, packed: 0 };
    b.n += 1;
    if (r.level === "quiet") b.quiet += 1;
    if (r.level === "packed") b.packed += 1;
    buckets.set(key, b);
  }
  const suggestions = [...buckets.values()]
    .filter((b) => b.quiet > 0)
    .map((b) => ({ ...b, share: b.quiet / b.n }))
    .sort((a, b) => b.share - a.share || a.packed - b.packed || a.weekday - b.weekday || a.hour - b.hour)
    .slice(0, MAX_SUGGESTIONS)
    .map((b) => ({ weekday: b.weekday, hour: b.hour, quietShare: Math.round(b.share * 100) / 100 }));
  return { suggestions, needed: 0 };
}
