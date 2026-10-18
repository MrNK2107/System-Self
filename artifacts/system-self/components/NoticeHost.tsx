// Mounted once in the tabs layout: shows unseen server notices one at a time with the existing modals.
import React from "react";
import { AchievementModal } from "@/components/AchievementModal";
import { FailureModal } from "@/components/FailureModal";
import { MilestoneModal } from "@/components/MilestoneModal";
import { RankUpModal } from "@/components/RankUpModal";
import { StreakBrokenModal } from "@/components/StreakBrokenModal";
import { SystemNoticeModal } from "@/components/SystemNoticeModal";
import { useNotices } from "@/hooks/useNotices";

export function NoticeHost() {
  const { group, view, dismiss } = useNotices();
  if (!group || !view) return null;

  // Keyed by the notice ids so each notice gets a fresh modal (animations and per-notice state reset).
  const key = group.notices.map((n) => n.id).join(",");
  const onAcknowledge = () => void dismiss();

  switch (view.modal) {
    case "rank_up":
      return (
        <RankUpModal
          key={key}
          visible
          fromRank={view.fromRank}
          toRank={view.toRank}
          newCodename={view.newCodename}
          onAcknowledge={onAcknowledge}
        />
      );
    case "achievement":
      return <AchievementModal key={key} visible achievement={view.achievement} onAcknowledge={onAcknowledge} />;
    case "milestone":
      return <MilestoneModal key={key} visible milestone={view.milestone} onAcknowledge={onAcknowledge} />;
    case "streak_break":
      return <StreakBrokenModal key={key} visible data={view.data} onAcknowledge={onAcknowledge} />;
    case "failure":
      return <FailureModal key={key} visible failures={view.failures} onAcknowledge={onAcknowledge} />;
    case "system":
      return (
        <SystemNoticeModal
          key={key}
          visible
          label={view.label}
          title={view.title}
          body={view.body}
          tone={view.tone}
          onAcknowledge={onAcknowledge}
        />
      );
  }
}
