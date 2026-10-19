import { daysBetween } from "./dates";

/** Consecutive empty local days before a log counts as a return. */
export const COMEBACK_MIN_GAP_DAYS = 5;
/** A gap this long (or having never trained at the gym) makes the home path an offer. */
export const HOME_PATH_OFFER_GAP_DAYS = 14;
/** Home sessions that clear Tier I and open the gym. */
export const HOME_SESSIONS_TO_UNLOCK = 6;
/** Log types that count as a home session while the home path is active. */
export const HOME_LOG_TYPES = ["home_session", "floor_session"] as const;

export const COMEBACK_CHECKLIST = [
  { key: "body_session", label: "Log one BODY session" },
  { key: "quests_today", label: "Complete today's quests" },
  { key: "two_domains", label: "Log two different domains today" },
] as const;
export type ComebackKey = (typeof COMEBACK_CHECKLIST)[number]["key"];

/**
 * Whether activity on `today` is a return: the empty days since the last activity (or since the onboarding date
 * for someone never active) number at least COMEBACK_MIN_GAP_DAYS. `gapDays` is that count of empty days.
 */
export function isComeback(
  lastActivityDate: string | null,
  today: string,
  onboardedOn: string,
): { comeback: boolean; gapDays: number } {
  if (lastActivityDate === null) {
    // Never active since onboarding: the gap runs from the onboarding date itself.
    const gap = Math.max(0, daysBetween(onboardedOn, today));
    return { comeback: gap >= COMEBACK_MIN_GAP_DAYS, gapDays: gap };
  }
  if (lastActivityDate < onboardedOn) return { comeback: false, gapDays: 0 };
  const gapDays = Math.max(0, daysBetween(lastActivityDate, today) - 1);
  return { comeback: gapDays >= COMEBACK_MIN_GAP_DAYS, gapDays };
}

export function shouldOfferHomePath(gapDays: number, gymSessions: number): boolean {
  return gapDays >= HOME_PATH_OFFER_GAP_DAYS || gymSessions === 0;
}

/** Which checklist items are done, from today's logs and quests. */
export function checklistDone(input: {
  logs: readonly { domain: string }[];
  questsCompletedToday: number;
  /** Active daily quests that are still open today. */
  dailiesPending: number;
}): Record<ComebackKey, boolean> {
  return {
    body_session: input.logs.some((l) => l.domain === "BODY"),
    quests_today: input.questsCompletedToday > 0 && input.dailiesPending === 0,
    two_domains: new Set(input.logs.map((l) => l.domain)).size >= 2,
  };
}
