// The one quest Today puts in front: domain, title, what it pays (the screen's hero figure), the deadline, and
// one filled action. Secondary actions are quiet text buttons underneath.
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/ui/Button";
import { DOMAIN_COLORS } from "@/constants/domains";
import { space, type } from "@/constants/type";
import { useColors } from "@/hooks/useColors";
import type { Quest } from "@/context/AppContext";
import type { Domain } from "@/lib/game/types";
import { questTargetLabel } from "@/lib/game/today";

export interface QuestAction {
  label: string;
  onPress: () => void;
  accessibilityLabel?: string;
}

interface Props {
  quest: Quest;
  reward: { delta: string; domain: Domain } | null;
  /** Deadline line, or the missed-slot line when the chosen slot has passed. */
  status: { text: string; urgent: boolean } | null;
  primary: QuestAction;
  secondary: QuestAction[];
  busy?: boolean;
}

const TYPE_LABEL: Record<string, string> = { daily: "Daily", weekly: "Weekly", arc: "Arc" };

export function NextQuestCard({ quest, reward, status, primary, secondary, busy }: Props) {
  const colors = useColors();
  const domainColor = DOMAIN_COLORS[quest.domain] ?? colors.primary;
  const chain = quest.chainTotal != null && quest.chainStep != null ? ` · step ${quest.chainStep + 1} of ${quest.chainTotal}` : "";

  return (
    <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={s.top}>
        <View style={s.domain}>
          <View style={[s.dot, { backgroundColor: domainColor }]} />
          <Text style={[type.label, { color: domainColor }]}>{quest.domain}</Text>
        </View>
        <Text style={[type.meta, { color: colors.subtle }]}>
          {TYPE_LABEL[quest.type] ?? quest.type}
          {chain}
        </Text>
      </View>

      <View style={s.copy}>
        <Text style={[type.title, { color: colors.foreground }]} accessibilityRole="header">
          {quest.title}
        </Text>
        {quest.description ? (
          <Text style={[type.body, { color: colors.mutedForeground }]} numberOfLines={3}>
            {quest.description}
          </Text>
        ) : null}
        <Text style={[type.label, { color: colors.subtle }]} accessibilityLabel={`Target: ${questTargetLabel(quest)}`}>
          {questTargetLabel(quest)}
        </Text>
      </View>

      {reward ? (
        <View accessible accessibilityLabel={`Reward ${reward.delta} ${reward.domain} at your current score. Your streak adds more.`}>
          <View style={s.reward}>
            <Text style={[type.display, { color: colors.foreground }]}>{reward.delta}</Text>
            <Text style={[type.label, s.rewardDomain, { color: DOMAIN_COLORS[reward.domain] }]}>{reward.domain}</Text>
          </View>
          {/* Same sentence as the quest sheet (lib/game/today rewardStatement); the completion window shows the exact amount. */}
          <Text style={[type.meta, { color: colors.mutedForeground }]}>At your current score. Your streak adds more.</Text>
        </View>
      ) : (
        <Text style={[type.bodyStrong, { color: colors.mutedForeground }]}>Bonus quest. No rank effect.</Text>
      )}

      {status ? (
        <Text style={[type.meta, { color: status.urgent ? colors.warn : colors.mutedForeground }]} accessibilityLiveRegion="polite">
          {status.text}
        </Text>
      ) : null}

      <View style={s.actions}>
        <Button
          label={primary.label}
          onPress={primary.onPress}
          loading={busy}
          block
          accessibilityLabel={primary.accessibilityLabel}
        />
        {secondary.length > 0 ? (
          <View style={s.secondary}>
            {secondary.map((a) => (
              <Button
                key={a.label}
                label={a.label}
                variant="text"
                onPress={a.onPress}
                disabled={busy}
                accessibilityLabel={a.accessibilityLabel}
              />
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 4, padding: space.md, gap: space.sm },
  top: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.sm },
  domain: { flexDirection: "row", alignItems: "center", gap: space.sm },
  dot: { width: 8, height: 8, borderRadius: 4 },
  copy: { gap: space.xs, marginTop: space.xs },
  reward: { flexDirection: "row", alignItems: "flex-end", gap: space.sm, marginTop: space.sm },
  rewardDomain: { marginBottom: space.sm + 2 },
  actions: { gap: space.xs, marginTop: space.sm },
  secondary: { flexDirection: "row", justifyContent: "center", flexWrap: "wrap", gap: space.sm },
});
