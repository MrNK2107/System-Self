import type { Weekday, WorkoutDay, WorkoutPlan } from "@/features/gym/model/types";

export function getWeekdayFromIsoDate(isoDate: string): Weekday {
  const day = new Date(isoDate).getDay();
  const map: Weekday[] = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
  return map[day] ?? "MON";
}

export function getPlanDayForDate(plan: WorkoutPlan | undefined, isoDate: string): WorkoutDay | undefined {
  if (!plan) return undefined;
  const weekday = getWeekdayFromIsoDate(isoDate);
  return plan.days.find((d) => d.weekday === weekday);
}

