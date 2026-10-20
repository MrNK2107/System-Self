import { Feather } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, View } from "react-native";

import { NoticeAction, NoticeBody, NoticeLine, NoticeShell } from "@/components/SystemNoticeModal";
import type { PendingAchievement } from "@/context/AppContext";
import { useColors } from "@/hooks/useColors";

interface Props {
  visible: boolean;
  achievement: PendingAchievement | null;
  onAcknowledge: () => void;
}

type IconName = React.ComponentProps<typeof Feather>["name"];
const iconOf = (name: string): IconName => (name in Feather.glyphMap ? (name as IconName) : "award");

/** [ ACHIEVEMENT ]: the icon, the title as THE SYSTEM's line, the condition met, one button. */
export function AchievementModal({ visible, achievement, onAcknowledge }: Props) {
  const colors = useColors();
  if (!visible || !achievement) return null;

  return (
    <NoticeShell visible={visible} title="ACHIEVEMENT" onClose={onAcknowledge}>
      <View style={[s.icon, { borderColor: colors.frame }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Feather name={iconOf(achievement.icon)} size={28} color={colors.primary} />
      </View>
      <NoticeLine text={achievement.title} />
      <NoticeBody>{achievement.description}</NoticeBody>
      <NoticeAction onPress={onAcknowledge} />
    </NoticeShell>
  );
}

const s = StyleSheet.create({
  icon: { alignSelf: "center", width: 64, height: 64, borderRadius: 4, borderWidth: 1, alignItems: "center", justifyContent: "center" },
});
