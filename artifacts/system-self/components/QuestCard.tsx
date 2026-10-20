// One quest as a list row: domain dot, title, one meta line, and the time left (amber under 3 h) or the outcome.
// Everything else about the quest (description, actions) lives in components/quests/QuestSheet.
import { Feather } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { ListRow } from "@/components/ui/ListRow";
import { DOMAIN_COLORS } from "@/constants/domains";
import { type } from "@/constants/type";
import type { Quest } from "@/context/AppContext";
import { useColors } from "@/hooks/useColors";
import { dueIn, questMeta } from "@/lib/game/quest-row";

/** Marks a bonus quest: it never touches the score or the rank. */
export const BONUS_LABEL = "BONUS — no rank effect";

interface QuestRowProps {
  quest: Quest;
  onPress: (quest: Quest) => void;
  /** Reference time for the due label (defaults to now). */
  now?: Date;
}

export function QuestRow({ quest, onPress, now }: QuestRowProps) {
  const colors = useColors();
  const active = quest.status === "active";
  const due = active ? dueIn(quest.expiresAt, now ?? new Date()) : null;

  const trailing = active ? (
    due ? (
      <Text style={[type.label, { color: due.urgent ? colors.warn : colors.subtle }]} accessibilityLabel={`${due.label} left`}>
        {due.label}
      </Text>
    ) : null
  ) : quest.status === "complete" ? (
    <Feather name="check-circle" size={22} color={colors.success} accessibilityLabel="Done" />
  ) : (
    <Feather name="x-circle" size={22} color={colors.subtle} accessibilityLabel={quest.status === "refused" ? "Refused" : "Missed"} />
  );

  return (
    <View style={!active && s.resolved}>
      <ListRow
        title={quest.title}
        subtitle={questMeta(quest)}
        dot={DOMAIN_COLORS[quest.domain] ?? colors.primary}
        trailing={trailing}
        onPress={() => onPress(quest)}
        accessibilityLabel={`${quest.title}, ${questMeta(quest)}${due ? `, ${due.label} left` : ""}. Open details`}
      />
    </View>
  );
}

const s = StyleSheet.create({
  resolved: { opacity: 0.7 },
});
