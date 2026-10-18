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
];

/**
 * Keeps the notices this build understands. Unknown kinds (from a newer server) and malformed payloads are
 * reported by id so the caller can mark them seen and skip them silently.
 */
export function parseNotices(raw: readonly unknown[]): { notices: Notice[]; unknownIds: string[] } {
  const notices: Notice[] = [];
  const unknownIds: string[] = [];
  for (const r of raw) {
    const parsed = NoticeSchema.safeParse(r);
    if (parsed.success) {
      notices.push(parsed.data);
      continue;
    }
    const id = r && typeof r === "object" ? (r as { id?: unknown }).id : undefined;
    if (typeof id === "string" && id) unknownIds.push(id);
  }
  return { notices, unknownIds };
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
  /** One notice, or every waiting quest_failed notice (they share one modal). */
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
    return { kind, notices: kind === "quest_failed" ? ofKind : [ofKind[0]!] };
  }
  return null;
}

export interface FailureItem {
  title: string;
  type: QuestType;
  penalty: number;
}

export type NoticeView =
  | { modal: "rank_up"; fromRank: Rank; toRank: Rank; newCodename: string }
  | { modal: "achievement"; achievement: PendingAchievement }
  | { modal: "milestone"; milestone: PendingMilestone }
  | { modal: "streak_break"; data: StreakBreakData }
  | { modal: "failure"; failures: FailureItem[] }
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
    case "quest_failed":
      return {
        modal: "failure",
        failures: group.notices.flatMap((n) =>
          n.kind === "quest_failed" ? [{ title: n.payload.title, type: n.payload.type, penalty: n.payload.penalty }] : [],
        ),
      };
  }
}
