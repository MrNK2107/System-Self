import React, { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";

import { NoticeAction, NoticeShell, Typewriter } from "@/components/SystemNoticeModal";
import { ALL_DOMAINS as DOMAINS, DOMAIN_COLORS } from "@/constants/domains";
import { space, type } from "@/constants/type";
import type { DebriefData, DebriefVerdict } from "@/context/AppContext";
import { useColors } from "@/hooks/useColors";
import { verdictHaptic } from "@/lib/haptics";

const VERDICT_SUB: Record<DebriefVerdict, string> = {
  ACCEPTABLE: "Noted. Maintain this.",
  INSUFFICIENT: "Below projection. Adjust.",
  PATHETIC: "This is a data point. Act on it.",
};

interface Props {
  visible: boolean;
  debrief: DebriefData;
  username: string;
  dayNumber: number;
  onAcknowledge: () => void;
}

const signed = (n: number) => (n === 0 ? "0.0" : `${n > 0 ? "+" : "−"}${Math.abs(n).toFixed(1)}`);

/** [ NIGHTLY DEBRIEF ]: the day's verdict, then each domain's change, quests done, and the shadow's lead. */
export function NightlyDebriefModal({ visible, debrief, username, dayNumber, onAcknowledge }: Props) {
  const colors = useColors();
  const verdictColor =
    debrief.verdict === "ACCEPTABLE" ? colors.success : debrief.verdict === "INSUFFICIENT" ? colors.warn : colors.destructive;

  // The verdict is delivered once per opening, not on every re-render or AI text update.
  useEffect(() => {
    if (visible) verdictHaptic();
  }, [visible]);

  if (!visible) return null;

  const when = new Date(debrief.date);
  const dateStr = Number.isNaN(when.getTime()) ? "" : when.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const gap = debrief.shadowGap;

  return (
    <NoticeShell visible={visible} title="NIGHTLY DEBRIEF" onClose={onAcknowledge}>
      <Text style={[type.meta, s.center, { color: colors.mutedForeground }]}>
        {[`Day ${dayNumber}`, dateStr, username].filter(Boolean).join(" · ")}
      </Text>

      <View style={s.verdict} accessible accessibilityLabel={`Verdict: ${debrief.verdict}. ${VERDICT_SUB[debrief.verdict]}`}>
        <Text style={[type.title, s.center, { color: verdictColor }]}>{debrief.verdict}</Text>
        <Text style={[type.meta, s.center, { color: colors.mutedForeground }]}>{VERDICT_SUB[debrief.verdict]}</Text>
      </View>

      {debrief.aiText ? <Typewriter text={debrief.aiText} style={[type.body, s.center, { color: colors.foreground }]} /> : null}

      <View>
        {DOMAINS.map((d) => {
          const delta = debrief.domainDeltas[d] ?? 0;
          const tint = delta > 0 ? colors.success : delta < 0 ? colors.destructive : colors.mutedForeground;
          return (
            <View key={d} style={[s.row, { borderBottomColor: colors.border }]} accessible accessibilityLabel={`${d} ${signed(delta)}`}>
              <View style={[s.dot, { backgroundColor: DOMAIN_COLORS[d] }]} />
              <Text style={[type.label, s.flex, { color: colors.foreground }]}>{d}</Text>
              <Text style={[type.number, { color: tint }]}>{signed(delta)}</Text>
            </View>
          );
        })}
        <View style={[s.row, { borderBottomColor: colors.border }]}>
          <Text style={[type.body, s.flex, { color: colors.foreground }]}>Quests completed</Text>
          <Text style={[type.number, { color: colors.foreground }]}>{`${debrief.questCompleted}/${debrief.questTotal}`}</Text>
        </View>
        <View style={s.row}>
          <View style={s.flex}>
            <Text style={[type.body, { color: colors.foreground }]}>Shadow self</Text>
            <Text style={[type.meta, { color: colors.mutedForeground }]}>
              {gap > 0 ? "Your shadow is ahead of you by this many points." : "You are ahead of your shadow by this many points."}
            </Text>
          </View>
          <Text style={[type.number, { color: gap > 0 ? colors.destructive : colors.success }]}>{Math.abs(gap).toFixed(1)}</Text>
        </View>
      </View>

      <NoticeAction label="Close debrief" onPress={onAcknowledge} />
    </NoticeShell>
  );
}

const s = StyleSheet.create({
  center: { textAlign: "center" },
  verdict: { gap: space.xs },
  row: { flexDirection: "row", alignItems: "center", gap: space.sm + 4, minHeight: 48, borderBottomWidth: StyleSheet.hairlineWidth },
  dot: { width: 8, height: 8, borderRadius: 4 },
  flex: { flex: 1 },
});
