import { addDays } from "./dates";

export const SEASON_KINDS = ["exam", "crunch", "competition", "launch", "away"] as const;
export type SeasonKind = (typeof SEASON_KINDS)[number];

export const LIFE_CONTEXT_KEYS = ["student", "professional", "shift_worker", "athlete", "founder", "parent", "traveling"] as const;
export type LifeContextKey = (typeof LIFE_CONTEXT_KEYS)[number];

export interface LifeContextDef {
  key: LifeContextKey;
  label: string;
  promptLine: string;
  /** Season kinds a user in this context may schedule (`away` is allowed for every context). */
  seasons: SeasonKind[];
}

export const LIFE_CONTEXTS: LifeContextDef[] = [
  { key: "student", label: "Student", promptLine: "Fit quests into gaps between classes. Prefer 20–45 minute blocks.", seasons: ["exam", "away"] },
  { key: "professional", label: "Professional", promptLine: "Fit quests around working hours: before 9, lunch, or after 18.", seasons: ["crunch", "away"] },
  { key: "shift_worker", label: "Shift worker", promptLine: "The user works rotating shifts. Never assume a 9–5 day. Prefer flexible-time quests.", seasons: ["away"] },
  { key: "athlete", label: "Athlete", promptLine: "Respect the user's training blocks. Do not add extra hard training on top of planned sessions.", seasons: ["competition", "away"] },
  { key: "founder", label: "Founder", promptLine: "Days are irregular. Prefer short, high-leverage quests; always offer a minimum version.", seasons: ["launch", "away"] },
  { key: "parent", label: "Parent", promptLine: "Windows are short. BODY quests must be doable at home in under 20 minutes.", seasons: ["away"] },
  { key: "traveling", label: "Traveling", promptLine: "No gym access assumed. Bodyweight or hotel-room sessions only.", seasons: ["away"] },
];

export function lifeContext(key: string): LifeContextDef {
  return LIFE_CONTEXTS.find((c) => c.key === key) ?? LIFE_CONTEXTS[0]!;
}

export function isLifeContextKey(key: string): key is LifeContextKey {
  return (LIFE_CONTEXT_KEYS as readonly string[]).includes(key);
}

export const SEASON_LINES: Record<SeasonKind, string> = {
  exam: "Exam Season. The volume drops. The standard does not.",
  crunch: "Crunch Week. The volume drops. The standard does not.",
  competition: "Competition Week. Taper. The standard does not drop.",
  launch: "Launch Week. The volume drops. The standard does not.",
  away: "Away Mode. No gym. No excuse.",
};

export const SEASON_PROMPT_LINE =
  "A season is active: make every quest smaller (about half the usual effort) and prefer home or bodyweight versions for BODY. Same count of quests.";

export const SEASON_MIN_LENGTH = 1;
export const SEASON_MAX_LENGTH = 14;
/** Full days required between one season's end and the next one's start. */
export const SEASON_COOLDOWN_DAYS = 7;

export type SeasonErrorCode = "season_conflict" | "invalid_kind" | "invalid_dates";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isRealDate(date: string): boolean {
  if (!DATE_RE.test(date)) return false;
  const d = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === date;
}

/**
 * Checks a season before it is scheduled. Seasons are planned ahead (start from tomorrow, local), never an
 * in-the-moment escape. `existing` is every season the user has ever had; one still running or scheduled
 * (ends today or later) blocks a new one, and a new start must clear the last end by SEASON_COOLDOWN_DAYS days.
 */
export function validateSeason(
  input: { kind: string; startsOn: string; lengthDays: number },
  ctx: { today: string; lifeContext: LifeContextKey; existing: { startsOn: string; endsOn: string }[] },
): { ok: true; endsOn: string } | { ok: false; code: SeasonErrorCode } {
  if (!lifeContext(ctx.lifeContext).seasons.includes(input.kind as SeasonKind)) return { ok: false, code: "invalid_kind" };
  const { startsOn, lengthDays } = input;
  if (
    !Number.isInteger(lengthDays) ||
    lengthDays < SEASON_MIN_LENGTH ||
    lengthDays > SEASON_MAX_LENGTH ||
    !isRealDate(startsOn) ||
    startsOn < addDays(ctx.today, 1)
  ) {
    return { ok: false, code: "invalid_dates" };
  }
  for (const e of ctx.existing) {
    if (e.endsOn >= ctx.today) return { ok: false, code: "season_conflict" };
    if (startsOn < addDays(e.endsOn, SEASON_COOLDOWN_DAYS + 1)) return { ok: false, code: "season_conflict" };
  }
  return { ok: true, endsOn: addDays(startsOn, lengthDays - 1) };
}
