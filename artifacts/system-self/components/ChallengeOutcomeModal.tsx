// A resolved rival challenge, as THE SYSTEM announces it: one window over the dimmed app with the outcome, both
// gains (coloured by what they mean for you) and one acknowledge action.
import React from "react";
import { Modal, StyleSheet, Text, View } from "react-native";

import { useToneColor } from "@/components/arena/parts";
import { Button } from "@/components/ui/Button";
import { SystemWindow } from "@/components/ui/SystemWindow";
import { DOMAIN_COLORS } from "@/constants/domains";
import { space, type } from "@/constants/type";
import { useColors } from "@/hooks/useColors";
import type { ChallengeResultView } from "@/lib/game/notices";
import { gapFromUser, signed } from "@/lib/social/arena";

interface Props {
  /** A resolved rival challenge (from its rival_challenge_result notice). */
  result: ChallengeResultView | null;
  visible: boolean;
  onAcknowledge: () => void;
}

const OUTCOME = {
  win: { label: "VICTORY", sub: "The rival has been suppressed." },
  loss: { label: "DEFEAT", sub: "The rival outpaced you. Correct course." },
  draw: { label: "STALEMATE", sub: "Neither side gained ground." },
} as const;

export function ChallengeOutcomeModal({ result: challenge, visible, onAcknowledge }: Props) {
  const colors = useColors();
  const tone = useToneColor();
  if (!challenge || !challenge.outcome) return null;

  const config = OUTCOME[challenge.outcome];
  const outcomeColor = challenge.outcome === "win" ? colors.success : challenge.outcome === "loss" ? colors.destructive : colors.warn;
  const userGain = challenge.userEnd - challenge.userStart;
  const rivalGain = challenge.rivalEnd - challenge.rivalStart;
  const gap = gapFromUser(userGain, rivalGain);

  return (
    <Modal transparent animationType="fade" visible={visible} statusBarTranslucent onRequestClose={onAcknowledge}>
      <View style={[s.overlay, { backgroundColor: "rgba(7,6,11,0.92)" }]}>
        <SystemWindow title="CHALLENGE COMPLETE" style={s.window} solid>
          <Text style={[type.display, s.center, { color: outcomeColor }]} accessibilityRole="header" numberOfLines={1} adjustsFontSizeToFit>
            {config.label}
          </Text>
          <Text style={[type.body, s.center, { color: colors.foreground }]}>{config.sub}</Text>
          <View style={s.line}>
            <View style={[s.dot, { backgroundColor: DOMAIN_COLORS[challenge.domain] }]} />
            <Text style={[type.meta, { color: colors.mutedForeground }]} numberOfLines={1}>
              {challenge.domain} vs {challenge.codename} · {challenge.startDate} to {challenge.endDate}
            </Text>
          </View>
          <View style={[s.gains, { borderColor: colors.border }]}>
            <View style={s.side}>
              <Text style={[type.label, { color: colors.mutedForeground }]}>YOUR GAIN</Text>
              <Text style={[type.number, { color: tone(gap.tone) }]}>{signed(userGain)}</Text>
              <Text style={[type.meta, { color: colors.subtle }]}>Final {challenge.userEnd.toFixed(1)}</Text>
            </View>
            <View style={s.side}>
              <Text style={[type.label, { color: colors.mutedForeground }]}>RIVAL GAIN</Text>
              <Text style={[type.number, { color: colors.foreground }]}>{signed(rivalGain)}</Text>
              <Text style={[type.meta, { color: colors.subtle }]}>Final {challenge.rivalEnd.toFixed(1)}</Text>
            </View>
          </View>
          <Button label="Acknowledge" block onPress={onAcknowledge} />
        </SystemWindow>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "center", paddingHorizontal: space.md },
  window: { gap: space.md },
  center: { textAlign: "center" },
  line: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space.sm },
  dot: { width: 8, height: 8, borderRadius: 4 },
  gains: { flexDirection: "row", borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: space.md },
  side: { flex: 1, alignItems: "center", gap: space.xs },
});
