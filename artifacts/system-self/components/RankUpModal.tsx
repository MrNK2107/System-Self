import React, { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";

import { NoticeAction, NoticeBody, NoticeLine, NoticeShell, useReducedMotion } from "@/components/SystemNoticeModal";
import { RankEmblem } from "@/components/ui/RankEmblem";
import { space, type } from "@/constants/type";
import type { Rank } from "@/context/AppContext";
import { useColors } from "@/hooks/useColors";

const RANK_NAMES: Record<Rank, string> = {
  E: "UNRANKED",
  D: "AWARE",
  C: "CONSISTENT",
  B: "DISCIPLINED",
  A: "ELITE",
  S: "SYSTEM-LEVEL",
};

// One cold acknowledgement per rank. These make no claim about mechanics: a rank-up changes nothing the app does
// besides the badge and the rival codename, so nothing here may promise more.
const RANK_LINES: Record<Rank, string> = {
  E: "Threshold crossed. New designation assigned.",
  D: "That was acceptable.",
  C: "Consistent. Keep it that way.",
  B: "Disciplined. The gap is closing.",
  A: "Elite. Now hold it.",
  S: "System-level. No further thresholds.",
};

interface Props {
  visible: boolean;
  fromRank: Rank;
  toRank: Rank;
  newCodename: string;
  onAcknowledge: () => void;
}

/** [ RANK UP ]: the new rank's emblem (the one glow in the app), its name, what changes, and the new codename. */
export function RankUpModal({ visible, fromRank, toRank, newCodename, onAcknowledge }: Props) {
  const colors = useColors();
  const reduce = useReducedMotion();
  const scale = useRef(new Animated.Value(0.85)).current;
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) return;
    if (reduce) {
      scale.setValue(1);
      fade.setValue(1);
      return;
    }
    scale.setValue(0.85);
    fade.setValue(0);
    Animated.parallel([
      Animated.timing(scale, { toValue: 1, duration: 520, delay: 160, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(fade, { toValue: 1, duration: 420, delay: 160, useNativeDriver: true }),
    ]).start();
  }, [visible, reduce, scale, fade]);

  if (!visible) return null;

  return (
    <NoticeShell visible={visible} title="RANK UP" onClose={onAcknowledge}>
      <Animated.View style={[s.emblem, { opacity: fade, transform: [{ scale }] }]}>
        <RankEmblem rank={toRank} size={136} />
      </Animated.View>
      <Text style={[type.label, s.center, { color: colors.mutedForeground }]}>
        {`RANK ${fromRank} → ${toRank} · ${RANK_NAMES[toRank]}`}
      </Text>
      <NoticeLine text={RANK_LINES[toRank] ?? RANK_LINES.E} />
      <View style={[s.codename, { borderTopColor: colors.border }]}>
        <Text style={[type.meta, s.center, { color: colors.mutedForeground }]}>Rivals now identify you as</Text>
        <Text style={[type.number, s.center, { color: colors.foreground }]} selectable>
          {newCodename}
        </Text>
      </View>
      <NoticeAction onPress={onAcknowledge} />
    </NoticeShell>
  );
}

const s = StyleSheet.create({
  emblem: { alignSelf: "center", marginVertical: space.sm },
  center: { textAlign: "center" },
  codename: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: space.md, gap: space.xs },
});
