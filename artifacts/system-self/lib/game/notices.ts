// Server notices -> one modal at a time. Pure, no React Native imports.
import { NoticeSchema, type Notice, type NoticeKind } from "@workspace/contracts";
import type { Domain, MilestoneTier, PendingAchievement, PendingMilestone, QuestType, Rank, StreakBreakData } from "./types";

/** The order modals are shown in. Every kind the server writes appears exactly once. */
export const NOTICE_ORDER: readonly NoticeKind[] = [
  "rank_change",
  "achievement",
  "milestone",
  "streak_break",
  "chain_complete",
  "shadow_activated",
  "shadow_resolved",
  "quest_failed",
  "comeback",
  "returner_mark",
  "gym_unlocked",
  "rival_challenge_result",
  "rival_passed",
  "raid_result",
  "challenge_received",
  "challenge_result",
  "shame",
];

/** Sent as `?kinds=` / `?noticeKinds=` with every notice read: the server returns and pages only kinds this build renders. */
export const NOTICE_KINDS_PARAM: string = NOTICE_ORDER.join(",");

/**
 * Keeps the notices this build understands. Unknown kinds (from a newer server) and malformed payloads are
 * skipped and only counted: they are never marked seen, so a newer client still shows them.
 */
export function parseNotices(raw: readonly unknown[]): { notices: Notice[]; skipped: number } {
  const notices: Notice[] = [];
  let skipped = 0;
  for (const r of raw) {
    const parsed = NoticeSchema.safeParse(r);
    if (parsed.success) notices.push(parsed.data);
    else skipped += 1;
  }
  return { notices, skipped };
}

/** Concatenates notice lists, keeping the first copy of each id. */
export function mergeNotices(...lists: readonly Notice[][]): Notice[] {
  const seen = new Set<string>();
  const out: Notice[] = [];
  for (const list of lists) {
    for (const n of list) {
      if (seen.has(n.id)) continue;
      seen.add(n.id);
      out.push(n);
    }
  }
  return out;
}

export interface NoticeGroup {
  kind: NoticeKind;
  /** One notice, or every waiting quest_failed / rival_passed / shame notice (each batch shares one modal). */
  notices: Notice[];
}

/** The next modal to show: the highest-priority kind, oldest notice first; null when nothing is waiting. */
export function nextNoticeGroup(notices: readonly Notice[], acknowledged: ReadonlySet<string>): NoticeGroup | null {
  const waiting = notices
    .filter((n) => !acknowledged.has(n.id))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const kind of NOTICE_ORDER) {
    const ofKind = waiting.filter((n) => n.kind === kind);
    if (ofKind.length === 0) continue;
    return { kind, notices: kind === "quest_failed" || kind === "rival_passed" || kind === "shame" ? ofKind : [ofKind[0]!] };
  }
  return null;
}

/** `{handle} failed to complete: {questTitle}. Logged.` */
export const shameLine = (p: { handle: string; questTitle: string }): string => `${p.handle} failed to complete: ${p.questTitle}. Logged.`;

const gainSigned = (n: number): string => {
  const r = Math.round(n * 10) / 10;
  return r > 0 ? `+${r.toFixed(1)}` : r.toFixed(1);
};

export interface FailureItem {
  title: string;
  type: QuestType;
  penalty: number;
}

/** A resolved rival challenge as the outcome modal shows it. */
export interface ChallengeResultView {
  codename: string;
  domain: Domain;
  outcome: "win" | "loss" | "draw";
  startDate: string;
  endDate: string;
  userStart: number;
  userEnd: number;
  rivalStart: number;
  rivalEnd: number;
}

export type NoticeView =
  | { modal: "rank_up"; fromRank: Rank; toRank: Rank; newCodename: string }
  | { modal: "achievement"; achievement: PendingAchievement }
  | { modal: "milestone"; milestone: PendingMilestone }
  | { modal: "streak_break"; data: StreakBreakData }
  | { modal: "failure"; failures: FailureItem[] }
  | { modal: "comeback"; gapDays: number; line: string; offerHomePath: boolean }
  | { modal: "challenge_result"; result: ChallengeResultView }
  | { modal: "system"; label: string; title: string; body: string; tone: "alert" | "info" };

const MILESTONE_TIER_VALUES: readonly number[] = [60, 70, 80, 90, 100];

/** Props for the modal that shows this group. */
export function noticeView(group: NoticeGroup): NoticeView {
  const first = group.notices[0]!;
  switch (first.kind) {
    case "rank_change": {
      const p = first.payload;
      if (p.kind === "promotion") return { modal: "rank_up", fromRank: p.from, toRank: p.to, newCodename: p.newCodename };
      return {
        modal: "system",
        tone: "alert",
        label: "RANK REVOKED",
        title: `RANK ${p.from} → ${p.to}`,
        body: `Your scores fell below the ${p.from} floor for seven days. You are reassigned: ${p.newCodename}.`,
      };
    }
    case "achievement":
      return { modal: "achievement", achievement: { ...first.payload } };
    case "milestone": {
      const p = first.payload;
      const tier = (MILESTONE_TIER_VALUES.includes(p.tier) ? p.tier : 60) as MilestoneTier;
      return { modal: "milestone", milestone: { domain: p.domain as Domain, tier, title: p.title } };
    }
    case "streak_break":
      return {
        modal: "streak_break",
        data: {
          detectedAt: first.createdAt,
          brokenDomains: first.payload.domains.map((d) => ({ domain: d.domain, lostStreak: d.lostStreak })),
          penalty: first.payload.penalty,
          aiText: "",
        },
      };
    case "chain_complete":
      return {
        modal: "system",
        tone: "info",
        label: "ARC CHAIN COMPLETE",
        title: first.payload.name,
        body: "Every step is logged. The system has recorded the arc. Do not stop here.",
      };
    case "shadow_activated":
      return {
        modal: "system",
        tone: "alert",
        label: "SHADOW SELF ACTIVATED",
        title: first.payload.codename,
        body: `Your shadow is awake and leads by ${first.payload.gap.toFixed(1)} pts. It gains every day you do not.`,
      };
    case "shadow_resolved":
      return {
        modal: "system",
        tone: "info",
        label: "SHADOW SELF RESOLVED",
        title: first.payload.codename,
        body: "You have overtaken your shadow in every domain. It returns to dormancy. It will wait.",
      };
    case "comeback":
      return {
        modal: "comeback",
        gapDays: first.payload.gapDays,
        line: first.payload.line,
        offerHomePath: first.payload.offerHomePath,
      };
    case "returner_mark":
      return {
        modal: "system",
        tone: "info",
        label: "RETURNER",
        title: first.payload.line,
        body: "Recorded. It pays nothing and it cannot be taken back.",
      };
    case "gym_unlocked":
      return {
        modal: "system",
        tone: "info",
        label: "TIER I CLEARED",
        title: "The gym is open to you now.",
        body: first.payload.line,
      };
    case "rival_passed": {
      // A ghost is a simulation: it carries the SIM tag wherever it is named.
      const lines = group.notices.flatMap((n) =>
        n.kind === "rival_passed"
          ? [`${n.payload.codename}${n.payload.isGhost ? " [SIM]" : ""} passed your ${n.payload.domain} score.`]
          : [],
      );
      const tail = "The order changed overnight. It is logged.";
      if (lines.length === 1) return { modal: "system", tone: "alert", label: "RIVAL PRESSURE", title: lines[0]!, body: tail };
      return {
        modal: "system",
        tone: "alert",
        label: "RIVAL PRESSURE",
        title: `${lines.length} RIVALS PASSED YOU`,
        body: [...lines, tail].join("\n"),
      };
    }
    case "rival_challenge_result": {
      const { challengeId: _id, ...result } = first.payload;
      return { modal: "challenge_result", result: { ...result, domain: result.domain as Domain } };
    }
    case "raid_result": {
      const p = first.payload;
      return {
        modal: "system",
        tone: p.won ? "info" : "alert",
        label: "RAID RESULT",
        title: `WEEK ${p.week}: POSITION ${p.position} OF ${p.count}`,
        body: p.line,
      };
    }
    case "challenge_received": {
      const p = first.payload;
      return {
        modal: "system",
        tone: "alert",
        label: "CHALLENGE RECEIVED",
        title: `${p.handle} challenged you.`,
        body: `${p.domain} // ${p.days} days. Highest domain gain wins: winner +3.0 DISCIPLINE, loser -1.5. Answer within 48 hours or it is ignored. Logged.`,
      };
    }
    case "challenge_result": {
      const p = first.payload;
      const gains = `${p.domain} gain: you ${gainSigned(p.myGain)}, ${p.handle} ${gainSigned(p.theirGain)}.`;
      if (p.outcome === "win") return { modal: "system", tone: "info", label: "CHALLENGE WON", title: `You beat ${p.handle}.`, body: `${gains} +${p.delta.toFixed(1)} DISCIPLINE. Logged.` };
      if (p.outcome === "loss") return { modal: "system", tone: "alert", label: "CHALLENGE LOST", title: `${p.handle} beat you.`, body: `${gains} ${p.delta.toFixed(1)} DISCIPLINE. Logged.` };
      return { modal: "system", tone: "info", label: "CHALLENGE DRAWN", title: `You and ${p.handle} finished level.`, body: `${gains} No score change. Logged.` };
    }
    case "shame": {
      const lines = group.notices.flatMap((n) => (n.kind === "shame" ? [shameLine(n.payload)] : []));
      if (lines.length === 1) return { modal: "system", tone: "alert", label: "SHAME MODE", title: lines[0]!, body: "They put it on the record. It stays there." };
      return { modal: "system", tone: "alert", label: "SHAME MODE", title: `${lines.length} CLANMATES FAILED`, body: lines.join("\n") };
    }
    case "quest_failed":
      return {
        modal: "failure",
        failures: group.notices.flatMap((n) =>
          n.kind === "quest_failed" ? [{ title: n.payload.title, type: n.payload.type, penalty: n.payload.penalty }] : [],
        ),
      };
  }
}
