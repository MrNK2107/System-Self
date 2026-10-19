// Mounted once in the tabs layout: shows unseen server notices one at a time with the existing modals.
import React, { useEffect } from "react";
import { AchievementModal } from "@/components/AchievementModal";
import { ChallengeOutcomeModal } from "@/components/ChallengeOutcomeModal";
import { FailureModal } from "@/components/FailureModal";
import { HomePathOffer } from "@/components/HomePathOffer";
import { MilestoneModal } from "@/components/MilestoneModal";
import { RankUpModal } from "@/components/RankUpModal";
import { StreakBrokenModal } from "@/components/StreakBrokenModal";
import { SystemNoticeModal } from "@/components/SystemNoticeModal";
import { useNotices } from "@/hooks/useNotices";
import { rankChangeHaptic, shadowActivatedHaptic } from "@/lib/haptics";

export function NoticeHost() {
  const { group, view, dismiss } = useNotices();
  // Keyed by the notice ids so each notice gets a fresh modal (animations and per-notice state reset).
  const key = group ? group.notices.map((n) => n.id).join(",") : "";
  const kind = !view ? null : view.modal === "rank_up" ? "rank" : view.modal === "system" && view.label === "SHADOW SELF ACTIVATED" ? "shadow" : null;

  // Haptics fire once per notice group (the effect re-runs only when the group changes), never on re-render.
  useEffect(() => {
    if (kind === "rank") rankChangeHaptic();
    else if (kind === "shadow") shadowActivatedHaptic();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (!group || !view) return null;

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
    case "comeback":
      return view.offerHomePath ? (
        <HomePathOffer key={key} gapDays={view.gapDays} line={view.line} onDone={onAcknowledge} />
      ) : (
        <SystemNoticeModal
          key={key}
          visible
          label="YOU RETURNED"
          title={view.line}
          body={`${view.gapDays} empty days. The record stands. Finish today's checklist.`}
          tone="info"
          onAcknowledge={onAcknowledge}
        />
      );
    case "challenge_result":
      // Dismissing marks the notice seen, which acknowledges the challenge on the server.
      return <ChallengeOutcomeModal key={key} visible result={view.result} onAcknowledge={onAcknowledge} />;
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
