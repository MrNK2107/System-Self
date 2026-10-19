// Pure push policy: which notice kinds push, their priority, the daily cap and the verbatim copy.
import type { NoticeKind, NoticePayload } from "@workspace/contracts";

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
/** A notice older than this when the worker first sees it is never pushed (it stays in-app). */
export const PUSH_MAX_AGE_MS = 24 * 3600_000;
export const PUSH_TITLE = "SYSTEM // SELF";

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
      return `${(payload as NoticePayload<"quest_deadline_24h">).count} quests expire tonight.`;
    case "challenge_result": {
      const o = (payload as NoticePayload<"challenge_result">).outcome;
      return o === "win" ? "Challenge resolved. You won." : o === "loss" ? "Challenge resolved. You lost." : "Challenge resolved. A draw.";
    }
    case "duo_checkin": {
      const p = payload as NoticePayload<"duo_checkin">;
      return p.kind === "going_now" ? `${p.handle} is going now.` : p.kind === "checked_in" ? `${p.handle} checked in.` : `${p.handle} is done.`;
    }
  }
}
