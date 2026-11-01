// Quest details: what the quest asks, when it is due, and what you can do with it. One primary action
// (Mark complete); the slot, briefing and Shame Mode sit as rows; Refuse is a quiet text action.
import { Feather } from "@expo/vector-icons";
import { questTargetLabel, rewardStatement } from "@/lib/game/today";
import { useGameStateQuery } from "@/hooks/useGameState";
import { needsSessionProof } from "@workspace/engine";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import React from "react";
import { StyleSheet, Switch, Text, View } from "react-native";

import { ProLock } from "@/components/ProLock";
import { Sheet } from "@/components/quests/Sheet";
import { Button } from "@/components/ui/Button";
import { ListRow } from "@/components/ui/ListRow";
import { DOMAIN_COLORS } from "@/constants/domains";
import { space, type } from "@/constants/type";
import type { Quest } from "@/context/AppContext";
import { useColors } from "@/hooks/useColors";
import { REFUSAL_RULE } from "@/lib/game/guards";
import { dueClock, dueIn } from "@/lib/game/quest-row";
import { slotLabel } from "@/lib/game/slots";

const TYPE_WORD: Record<Quest["type"], string> = { daily: "Daily quest", weekly: "Weekly quest", arc: "Arc quest" };
const OUTCOME: Record<Exclude<Quest["status"], "active">, string> = {
  complete: "Done. Recorded.",
  failed: "Missed. The deadline passed.",
  refused: "Refused.",
};

interface QuestSheetProps {
  quest: Quest | null;
  busy: boolean;
  /** Error line from the last request on this screen. */
  notice?: string | null;
  onClose: () => void;
  onComplete: (id: string) => void;
  /** Lock the slot (active BODY dailies). */
  onSlot?: (quest: Quest) => void;
  /** Today's dungeon briefing (active BODY quests). */
  onBriefing?: (quest: Quest) => void;
  /** PRO Shame Mode toggle (clan members, rank quests). */
  onShame?: (quest: Quest, enabled: boolean) => void;
  /** The server answered 402 for Shame Mode. */
  shameLocked?: boolean;
  /** Refuse (active dailies). */
  onRefuse?: (quest: Quest) => void;
  /** The weekly refusal allowance is used up. */
  refuseDisabled?: boolean;
}

function Fact({ label, value, tone }: { label: string; value: string; tone?: string }) {
  const colors = useColors();
  return (
    <View style={s.fact}>
      <Text style={[type.meta, s.factLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <Text style={[type.body, s.factValue, { color: tone ?? colors.foreground }]}>{value}</Text>
    </View>
  );
}

export function QuestSheet({
  quest, busy, notice, onClose, onComplete, onSlot, onBriefing, onShame, shameLocked, onRefuse, refuseDisabled = false,
}: QuestSheetProps) {
  const colors = useColors();
  const gameScores = useGameStateQuery().data?.scores;
  if (!quest) return <Sheet visible={false} onClose={onClose}>{null}</Sheet>;

  const active = quest.status === "active";
  const domainColor = DOMAIN_COLORS[quest.domain] ?? colors.primary;
  const due = dueIn(quest.expiresAt, new Date());
  const clock = dueClock(quest.expiresAt);
  const slot = slotLabel(quest);
  const isBody = quest.domain === "BODY";
  const canSlot = active && isBody && quest.type === "daily" && !!onSlot;
  const canBrief = active && isBody && !!onBriefing;
  const canShame = active && !quest.bonus && !!onShame;
  const canRefuse = active && quest.type === "daily" && !!onRefuse;

  const complete = () => {
    if (busy) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onComplete(quest.id);
  };
  const refuse = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onRefuse?.(quest);
  };

  return (
    <Sheet
      visible
      title={quest.title}
      onClose={onClose}
      footer={
        active ? (
          <>
            {needsSessionProof(quest.target) ? (
              <Button
                label="Start session"
                onPress={() => {
                  onClose();
                  router.push({ pathname: "/session/[questId]", params: { questId: quest.id } });
                }}
                block
                accessibilityLabel="Start a live session to prove this quest"
              />
            ) : (
              <Button label="Mark complete" onPress={complete} loading={busy} block />
            )}
            {!quest.bonus ? (
              <Button
                label="Ask a friend to vouch"
                variant="text"
                onPress={() => {
                  onClose();
                  router.push({ pathname: "/vouch/[questId]", params: { questId: quest.id } });
                }}
                block
              />
            ) : null}
            {canRefuse ? (
              <Button
                label="Refuse quest"
                variant="text"
                onPress={refuse}
                disabled={refuseDisabled || busy}
                block
                accessibilityLabel="Refuse"
              />
            ) : null}
          </>
        ) : undefined
      }
    >
      <View style={s.metaRow}>
        <View style={[s.dot, { backgroundColor: domainColor }]} />
        <Text style={[type.meta, { color: colors.mutedForeground }]}>
          {`${TYPE_WORD[quest.type]} · ${quest.domain}`}
          {quest.chainStep != null && quest.chainTotal != null ? ` · step ${quest.chainStep + 1} of ${quest.chainTotal}` : ""}
        </Text>
      </View>

      {quest.description ? <Text style={[type.body, { color: colors.foreground }]}>{quest.description}</Text> : null}

      <View style={[s.facts, { borderColor: colors.border }]}>
        {active && clock ? (
          <Fact
            label="Due"
            value={due && due.label !== "due" ? `${clock} · ${due.label} left` : clock}
            tone={due?.urgent ? colors.warn : undefined}
          />
        ) : null}
        <Fact label="Target" value={questTargetLabel(quest)} />
        <Fact label="Reward" value={rewardStatement(quest, gameScores?.find((sc) => sc.domain === quest.domain)?.score)} />
        {quest.status !== "active" ? <Fact label="Outcome" value={OUTCOME[quest.status]} tone={quest.status === "complete" ? colors.success : colors.mutedForeground} /> : null}
      </View>

      {notice ? <Text style={[type.meta, { color: colors.destructive }]}>{notice}</Text> : null}

      {canSlot || canBrief || canShame ? (
        <View style={[s.actions, { borderTopColor: colors.border }]}>
          {canSlot ? (
            <ListRow
              title={slot ? `Slot locked ${slot}` : "Lock the slot"}
              subtitle={slot ? "Change or clear it." : "Pick the hour you will do it."}
              chevron
              onPress={busy ? undefined : () => onSlot!(quest)}
              accessibilityLabel={slot ? "Change slot" : "Lock slot"}
            />
          ) : null}
          {canBrief ? (
            <ListRow
              title="Briefing"
              subtitle="Today's route through the gym."
              chevron
              onPress={busy ? undefined : () => onBriefing!(quest)}
              accessibilityLabel="Briefing"
            />
          ) : null}
          {canShame ? (
            <ListRow
              title="Shame mode"
              subtitle="Your clan is told if this quest fails."
              trailing={
                <Switch
                  value={!!quest.shameMode}
                  onValueChange={(v) => onShame!(quest, v)}
                  disabled={busy}
                  trackColor={{ false: colors.muted, true: colors.destructive }}
                  thumbColor={colors.foreground}
                  accessibilityLabel="Shame Mode"
                />
              }
            />
          ) : null}
        </View>
      ) : null}
      {canShame && shameLocked ? <ProLock label="SHAME MODE" /> : null}

      {canRefuse && refuseDisabled ? (
        <View style={s.metaRow}>
          <Feather name="slash" size={16} color={colors.mutedForeground} />
          <Text style={[type.meta, s.flex, { color: colors.mutedForeground }]}>{REFUSAL_RULE}</Text>
        </View>
      ) : null}
    </Sheet>
  );
}

const s = StyleSheet.create({
  metaRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
  dot: { width: 8, height: 8, borderRadius: 4 },
  facts: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: space.sm, marginTop: space.sm, gap: space.xs },
  fact: { flexDirection: "row", gap: space.md, paddingVertical: space.xs },
  factLabel: { width: 72, paddingTop: 3 },
  factValue: { flex: 1 },
  actions: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: space.sm, marginHorizontal: -space.md },
  flex: { flex: 1 },
});
