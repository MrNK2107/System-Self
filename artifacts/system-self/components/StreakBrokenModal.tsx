import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { NoticeAction, NoticeFigure, NoticeShell, Typewriter } from "@/components/SystemNoticeModal";
import { DOMAIN_COLORS } from "@/constants/domains";
import { space, type } from "@/constants/type";
import { useApp, type StreakBreakData } from "@/context/AppContext";
import { useColors } from "@/hooks/useColors";
import { useSystemAI } from "@/hooks/useSystemAI";

interface Props {
  visible: boolean;
  data: StreakBreakData;
  onAcknowledge: () => void;
}

/** [ STREAK BROKEN ]: which domain streaks reset, the DISCIPLINE penalty, and THE SYSTEM's assessment. */
export function StreakBrokenModal({ visible, data, onAcknowledge }: Props) {
  const colors = useColors();
  const { user } = useApp();
  const userId = user?.id;
  const { generateMessage } = useSystemAI();
  const [aiText, setAiText] = useState(data.aiText || "");

  // Fetch THE SYSTEM's line when the notice did not carry one.
  useEffect(() => {
    if (!visible || aiText || !userId) return;
    let cancelled = false;
    void generateMessage("streak_break").then((text) => {
      if (!cancelled) setAiText(text);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, userId]);

  if (!visible) return null;

  const when = new Date(data.detectedAt);
  const stamp = Number.isNaN(when.getTime())
    ? null
    : `${when.toLocaleDateString("en-US", { month: "short", day: "numeric" })}, ${when.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;

  return (
    <NoticeShell visible={visible} title="STREAK BROKEN" frameColor={colors.destructive} onClose={onAcknowledge}>
      <View>
        {data.brokenDomains.map((b) => (
          <View key={b.domain} style={[s.row, { borderBottomColor: colors.border }]}>
            <View style={[s.dot, { backgroundColor: DOMAIN_COLORS[b.domain] }]} />
            <Text style={[type.label, s.flex, { color: colors.foreground }]}>{b.domain}</Text>
            <Text style={[type.meta, { color: colors.mutedForeground }]}>{`${b.lostStreak}-day streak reset to 0`}</Text>
          </View>
        ))}
      </View>
      <NoticeFigure value={`−${data.penalty.toFixed(1)}`} unit="DISCIPLINE" color={colors.destructive} />
      {aiText ? (
        <Typewriter text={aiText} style={[type.title, s.center, { color: colors.foreground }]} />
      ) : (
        <Text style={[type.meta, s.center, { color: colors.subtle }]}>The System is writing its assessment.</Text>
      )}
      {stamp ? <Text style={[type.meta, s.center, { color: colors.subtle }]}>{`Detected ${stamp}`}</Text> : null}
      <NoticeAction onPress={onAcknowledge} />
    </NoticeShell>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: space.sm + 4, minHeight: 48, borderBottomWidth: StyleSheet.hairlineWidth },
  dot: { width: 8, height: 8, borderRadius: 4 },
  flex: { flex: 1 },
  center: { textAlign: "center" },
});
