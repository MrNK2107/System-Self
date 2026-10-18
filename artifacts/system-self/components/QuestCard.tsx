import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import type { Quest } from "@/context/AppContext";
import { DOMAIN_COLORS } from "@/constants/domains";

interface QuestCardProps {
  quest: Quest;
  onComplete: (id: string) => void;
  onRefuse?: (id: string) => void;
}

const TYPE_LABELS: Record<string, string> = {
  daily: "DAILY",
  weekly: "WEEKLY",
  arc: "ARC",
};

export function QuestCard({ quest, onComplete, onRefuse }: QuestCardProps) {
  const colors = useColors();
  const domainColor = DOMAIN_COLORS[quest.domain] ?? colors.primary;
  const isActive = quest.status === "active";
  const isComplete = quest.status === "complete";
  const isFailed = quest.status === "failed";
  const isRefused = quest.status === "refused";

  const handleComplete = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onComplete(quest.id);
  };

  const handleRefuse = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onRefuse?.(quest.id);
  };

  return (
    <View style={[
      styles.card,
      {
        backgroundColor: colors.card,
        borderColor: isComplete ? colors.muted :
          isFailed || isRefused ? colors.destructive + "40" :
          domainColor + "30",
        borderWidth: 1,
        opacity: isComplete || isFailed || isRefused ? 0.6 : 1,
      }
    ]}>
      <View style={styles.header}>
        <View style={styles.badges}>
          <View style={[styles.typeBadge, { borderColor: domainColor + "60" }]}>
            <Text style={[styles.typeText, { color: domainColor }]}>{TYPE_LABELS[quest.type]}</Text>
          </View>
          <Text style={[styles.domainText, { color: colors.mutedForeground }]}>{quest.domain}</Text>
        </View>
        {isComplete && <Feather name="check" size={16} color={colors.mutedForeground} />}
        {(isFailed || isRefused) && <Feather name="x" size={16} color={colors.destructive} />}
      </View>

      <Text style={[styles.title, { color: isComplete ? colors.mutedForeground : colors.foreground }]}>
        {quest.title}
      </Text>
      <Text style={[styles.description, { color: colors.mutedForeground }]}>
        {quest.description}
      </Text>

      {isActive && (
        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.completeBtn, { borderColor: domainColor + "80", backgroundColor: domainColor + "15" }]}
            onPress={handleComplete}
            activeOpacity={0.7}
          >
            <Text style={[styles.completeBtnText, { color: domainColor }]}>MARK COMPLETE</Text>
          </TouchableOpacity>
          {onRefuse && quest.type === "daily" && (
            <TouchableOpacity
              style={[styles.refuseBtn, { borderColor: colors.border }]}
              onPress={handleRefuse}
              activeOpacity={0.7}
            >
              <Feather name="x" size={14} color={colors.mutedForeground} />
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 16,
    borderRadius: 4,
    gap: 8,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  badges: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  typeBadge: {
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 2,
  },
  typeText: {
    fontSize: 9,
    fontWeight: "700" as const,
    letterSpacing: 1.5,
  },
  domainText: {
    fontSize: 9,
    letterSpacing: 1.5,
    fontWeight: "600" as const,
  },
  title: {
    fontSize: 14,
    fontWeight: "600" as const,
    lineHeight: 20,
  },
  description: {
    fontSize: 12,
    lineHeight: 18,
  },
  actions: {
    flexDirection: "row",
    gap: 8,
    marginTop: 4,
  },
  completeBtn: {
    flex: 1,
    borderWidth: 1,
    paddingVertical: 8,
    alignItems: "center",
    borderRadius: 2,
  },
  completeBtnText: {
    fontSize: 10,
    fontWeight: "700" as const,
    letterSpacing: 2,
  },
  refuseBtn: {
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 2,
  },
});
