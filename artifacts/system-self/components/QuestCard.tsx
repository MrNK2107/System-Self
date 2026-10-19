import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import type { Quest } from "@/context/AppContext";
import { DOMAIN_COLORS } from "@/constants/domains";
import { slotLabel } from "@/lib/game/slots";

interface QuestCardProps {
  quest: Quest;
  onComplete: (id: string) => void;
  onRefuse?: (quest: Quest) => void;
  /** Opens the slot picker (shown for active BODY quests only). */
  onSlot?: (quest: Quest) => void;
  /** Opens today's dungeon briefing (shown for active BODY quests). */
  onBriefing?: (quest: Quest) => void;
  /** PRO Shame Mode toggle, offered on active quests when the user is in a clan. */
  onShame?: (quest: Quest, enabled: boolean) => void;
  /** The weekly refusal allowance is used up (server 409 refusal_limit). */
  refuseDisabled?: boolean;
  /** A request for this quest is in flight. */
  busy?: boolean;
}

const TYPE_LABELS: Record<string, string> = {
  daily: "DAILY",
  weekly: "WEEKLY",
  arc: "ARC",
};

export function QuestCard({ quest, onComplete, onRefuse, onSlot, onBriefing, onShame, refuseDisabled = false, busy = false }: QuestCardProps) {
  const colors = useColors();
  const domainColor = DOMAIN_COLORS[quest.domain] ?? colors.primary;
  const isActive = quest.status === "active";
  const isComplete = quest.status === "complete";
  const isFailed = quest.status === "failed";
  const isRefused = quest.status === "refused";

  const handleComplete = () => {
    if (busy) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onComplete(quest.id);
  };

  const handleRefuse = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onRefuse?.(quest);
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
          {quest.chainTotal != null && quest.chainStep != null && (
            <Text style={[styles.domainText, { color: colors.mutedForeground, fontFamily: "SpaceMono" }]}>
              STEP {quest.chainStep + 1}/{quest.chainTotal}
            </Text>
          )}
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

      {isActive && quest.domain === "BODY" && quest.type === "daily" && onSlot && (
        <TouchableOpacity
          onPress={() => onSlot(quest)}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={slotLabel(quest) ? "Change slot" : "Lock slot"}
          style={[styles.slotRow, { borderColor: colors.border, opacity: busy ? 0.5 : 1 }]}
          activeOpacity={0.7}
        >
          <Feather name="clock" size={12} color={slotLabel(quest) ? domainColor : colors.mutedForeground} />
          <Text style={[styles.slotText, { color: slotLabel(quest) ? domainColor : colors.mutedForeground }]}>
            {slotLabel(quest) ? `LOCKED ${slotLabel(quest)}` : "LOCK THE SLOT"}
          </Text>
        </TouchableOpacity>
      )}

      {isActive && quest.domain === "BODY" && onBriefing && (
        <TouchableOpacity
          onPress={() => onBriefing(quest)}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel="Briefing"
          style={[styles.slotRow, { borderColor: colors.border, opacity: busy ? 0.5 : 1 }]}
          activeOpacity={0.7}
        >
          <Feather name="map" size={12} color={domainColor} />
          <Text style={[styles.slotText, { color: domainColor }]}>BRIEFING</Text>
        </TouchableOpacity>
      )}

      {isActive && onShame && (
        <TouchableOpacity
          onPress={() => onShame(quest, !quest.shameMode)}
          disabled={busy}
          accessibilityRole="switch"
          accessibilityState={{ checked: !!quest.shameMode, disabled: busy }}
          accessibilityLabel="Shame Mode"
          style={[styles.slotRow, { borderColor: quest.shameMode ? colors.destructive : colors.border, opacity: busy ? 0.5 : 1 }]}
          activeOpacity={0.7}
        >
          <Feather name="alert-triangle" size={12} color={quest.shameMode ? colors.destructive : colors.mutedForeground} />
          <Text style={[styles.slotText, { color: quest.shameMode ? colors.foreground : colors.mutedForeground }]}>
            {quest.shameMode ? "SHAME MODE ON" : "SHAME MODE OFF"}
          </Text>
        </TouchableOpacity>
      )}

      {isActive && (
        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.completeBtn, { borderColor: domainColor + "80", backgroundColor: domainColor + "15", opacity: busy ? 0.5 : 1 }]}
            onPress={handleComplete}
            disabled={busy}
            activeOpacity={0.7}
          >
            <Text style={[styles.completeBtnText, { color: domainColor }]}>MARK COMPLETE</Text>
          </TouchableOpacity>
          {onRefuse && quest.type === "daily" && (
            <TouchableOpacity
              style={[styles.refuseBtn, { borderColor: colors.border, opacity: refuseDisabled || busy ? 0.35 : 1 }]}
              onPress={handleRefuse}
              disabled={refuseDisabled || busy}
              accessibilityLabel="Refuse"
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
  slotRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: 2,
    paddingHorizontal: 10,
    paddingVertical: 7,
    alignSelf: "flex-start",
  },
  slotText: { fontSize: 10, fontWeight: "700" as const, letterSpacing: 1.5 },
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
