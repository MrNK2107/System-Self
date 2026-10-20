import React from "react";

import { NoticeAction, NoticeBody, NoticeFigure, NoticeLine, NoticeShell } from "@/components/SystemNoticeModal";
import { DOMAIN_COLORS } from "@/constants/domains";
import type { PendingMilestone } from "@/context/AppContext";

interface Props {
  visible: boolean;
  milestone: PendingMilestone | null;
  onAcknowledge: () => void;
}

const TIER_LINES: Record<number, string> = {
  60: "Foundation complete. The baseline is now structural.",
  70: "Competence confirmed. This domain no longer holds you back.",
  80: "Elite territory. Few reach this without deliberate architecture.",
  90: "The gap between you and the average is now unmeasurable.",
  100: "Sovereignty achieved. This domain is yours. Completely.",
};

/** [ MILESTONE ]: a domain crossed a score threshold. The window takes the domain's colour. */
export function MilestoneModal({ visible, milestone, onAcknowledge }: Props) {
  if (!visible || !milestone) return null;
  const color = DOMAIN_COLORS[milestone.domain];

  return (
    <NoticeShell visible={visible} title="MILESTONE" frameColor={color} onClose={onAcknowledge}>
      <NoticeFigure value={String(milestone.tier)} unit={milestone.domain} color={color} />
      <NoticeLine text={milestone.title} />
      <NoticeBody>{TIER_LINES[milestone.tier] ?? "Threshold crossed."}</NoticeBody>
      <NoticeAction onPress={onAcknowledge} />
    </NoticeShell>
  );
}
