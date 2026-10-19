// Pure push policy: which notice kinds push, their priority, the daily cap and the verbatim copy.
import { questsExpireLine, type NoticeKind, type NoticePayload } from "@workspace/contracts";
import { addDays, localDate, localTimeToInstant } from "@workspace/engine";

/** Notice kinds that may become a push, highest priority first. Everything else stays in-app only. */
export const PUSH_PRIORITY = [
  "rank_change",
  "shadow_activated",
  "rival_passed",
  "raid_result",
  "quest_deadline_24h",
  "challenge_result",
  "duo_checkin",
] as const satisfies readonly NoticeKind[];
export type PushKind = (typeof PUSH_PRIORITY)[number];

export const isPushKind = (kind: string): kind is PushKind => (PUSH_PRIORITY as readonly string[]).includes(kind);

/** At most this many system notifications per user per local day, counting the on-device morning and nightly reminders. */
export const DAILY_CAP = 3;
/**
 * A notice is never pushed (it stays in-app) once this long has passed since it first became deliverable: its creation
 * when that was inside the user's delivery window, else the next opening of the window. So an overnight notice is
 * pushed in the morning instead of dropped.
 */
export const PUSH_MAX_AGE_MS = 24 * 3600_000;
export const PUSH_TITLE = "SYSTEM // SELF";

/** Event pushes go out only in the user's local delivery window: max(08:00, morning briefing) until 22:00. */
export const WINDOW_EARLIEST_OPEN = "08:00";
export const WINDOW_CLOSE = "22:00";
/** A briefing set after this still leaves an hour of window: the opening is capped here. */
export const WINDOW_LATEST_OPEN = "21:00";

const toMinutes = (hhmm: string): number | null => {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? h * 60 + min : null;
};

/** Local opening minute of the window: max(08:00, briefing) capped at 21:00; an unreadable briefing time means 08:00. */
export function windowOpenMinute(morningTime: string | null | undefined): number {
  const earliest = toMinutes(WINDOW_EARLIEST_OPEN)!;
  const briefing = morningTime ? toMinutes(morningTime) : null;
  return Math.min(Math.max(earliest, briefing ?? earliest), toMinutes(WINDOW_LATEST_OPEN)!);
}
export const WINDOW_CLOSE_MINUTE = toMinutes(WINDOW_CLOSE)!;

/** The window of local `date` as instants. */
export function deliveryWindow(date: string, timeZone: string, morningTime: string | null | undefined) {
  const open = windowOpenMinute(morningTime);
  return {
    open: localTimeToInstant(date, Math.floor(open / 60), open % 60, timeZone),
    close: localTimeToInstant(date, Math.floor(WINDOW_CLOSE_MINUTE / 60), WINDOW_CLOSE_MINUTE % 60, timeZone),
  };
}

/** True while `now` is inside the user's delivery window. */
export function inDeliveryWindow(now: Date, timeZone: string, morningTime: string | null | undefined): boolean {
  const w = deliveryWindow(localDate(now, timeZone), timeZone, morningTime);
  return now.getTime() >= w.open.getTime() && now.getTime() < w.close.getTime();
}

/** When a notice created at `createdAt` first became deliverable (see PUSH_MAX_AGE_MS). */
export function deliverableFrom(createdAt: Date, timeZone: string, morningTime: string | null | undefined): Date {
  const date = localDate(createdAt, timeZone);
  const w = deliveryWindow(date, timeZone, morningTime);
  if (createdAt.getTime() < w.open.getTime()) return w.open;
  if (createdAt.getTime() < w.close.getTime()) return createdAt;
  return deliveryWindow(addDays(date, 1), timeZone, morningTime).open;
}

/** Event slots left once the enabled on-device reminders have reserved theirs. */
export function eventSlots(prefs: { morning: boolean; nightly: boolean }): number {
  return DAILY_CAP - (prefs.morning ? 1 : 0) - (prefs.nightly ? 1 : 0);
}

/** Highest priority first, then oldest first. */
export function rankCandidates<T extends { kind: PushKind; createdAt: Date }>(items: readonly T[]): T[] {
  return [...items].sort(
    (a, b) => PUSH_PRIORITY.indexOf(a.kind) - PUSH_PRIORITY.indexOf(b.kind) || a.createdAt.getTime() - b.createdAt.getTime(),
  );
}

const oneDecimal = (n: number): string => String(Math.round(n * 10) / 10);

/** The push body for a notice of a push kind (verbatim PRD copy; no streak reminders, quotes or counts beyond the copy). */
export function pushCopy<K extends PushKind>(kind: K, payload: NoticePayload<K>): string {
  switch (kind) {
    case "rank_change": {
      const p = payload as NoticePayload<"rank_change">;
      return p.kind === "promotion"
        ? `Rank promotion. ${p.from} → ${p.to}.`
        : `Rank demotion. ${p.from} → ${p.to}. Your score fell below threshold for 7 consecutive days.`;
    }
    case "shadow_activated":
      return `Shadow Self initialized. Gap: ${oneDecimal((payload as NoticePayload<"shadow_activated">).gap)} points. It will not wait for you.`;
    case "rival_passed": {
      const p = payload as NoticePayload<"rival_passed">;
      return `${p.codename} moved past you in ${p.domain}.`;
    }
    case "raid_result": {
      const p = payload as NoticePayload<"raid_result">;
      return `RAID RESULT — Week ${p.week}. Your clan placed ${p.position} of ${p.count}.`;
    }
    case "quest_deadline_24h":
      return questsExpireLine((payload as NoticePayload<"quest_deadline_24h">).count);
    case "challenge_result": {
      const o = (payload as NoticePayload<"challenge_result">).outcome;
      return o === "win" ? "Challenge resolved. You won." : o === "loss" ? "Challenge resolved. You lost." : "Challenge resolved. A draw.";
    }
    case "duo_checkin": {
      const p = payload as NoticePayload<"duo_checkin">;
      // No handle on a lock screen: the in-app notice names the partner.
      return p.kind === "going_now" ? "Duo partner is going now." : p.kind === "checked_in" ? "Duo partner checked in." : "Duo partner is done.";
    }
  }
}
