// Arc chains: a row per chain in the Arcs list, and a sheet with its steps (and START for a catalog template).
import { Feather } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { Sheet } from "@/components/quests/Sheet";
import { Button } from "@/components/ui/Button";
import { ListRow } from "@/components/ui/ListRow";
import { DOMAIN_COLORS } from "@/constants/domains";
import { space, type } from "@/constants/type";
import type { ChainTemplate, QuestChain } from "@/context/AppContext";
import { useColors } from "@/hooks/useColors";

const STATUS_WORD: Record<QuestChain["status"], string> = { active: "active", complete: "complete", abandoned: "abandoned" };

/** One chain in a list: name, "step 2 of 5 · active", and steps done on the right. */
export function QuestChainRow({ chain, onPress }: { chain: QuestChain; onPress: (chain: QuestChain) => void }) {
  const colors = useColors();
  const done = Math.min(chain.totalSteps, chain.currentStep);
  const meta =
    chain.status === "active"
      ? `${chain.domain} · step ${Math.min(done + 1, chain.totalSteps)} of ${chain.totalSteps}`
      : `${chain.domain} · ${STATUS_WORD[chain.status]}`;
  return (
    <ListRow
      title={chain.name}
      subtitle={meta}
      dot={DOMAIN_COLORS[chain.domain]}
      trailing={
        chain.status === "complete" ? (
          <Feather name="check-circle" size={22} color={colors.success} accessibilityLabel="Complete" />
        ) : (
          <Text style={[type.label, { color: colors.subtle }]}>{`${done}/${chain.totalSteps}`}</Text>
        )
      }
      chevron
      onPress={() => onPress(chain)}
    />
  );
}

/** A template in the catalog list. */
export function ChainTemplateRow({ template, started, onPress }: { template: ChainTemplate; started: boolean; onPress: (t: ChainTemplate) => void }) {
  return (
    <ListRow
      title={template.name}
      subtitle={`${template.domain} · ${template.steps.length} steps${started ? " · active" : ""}`}
      dot={DOMAIN_COLORS[template.domain]}
      chevron
      onPress={() => onPress(template)}
    />
  );
}

/** The step list. `current` is the index of the step in progress (omit for a template not yet started). */
function ChainSteps({ steps, current, finished, domainColor }: {
  steps: ChainTemplate["steps"];
  current?: number;
  finished?: boolean;
  domainColor: string;
}) {
  const colors = useColors();
  return (
    <View style={s.steps}>
      {steps.map((step, i) => {
        const done = current != null && (finished || i < current);
        const now = current != null && !finished && i === current;
        return (
          <View key={i} style={[s.step, { borderBottomColor: colors.border }]}>
            <View style={s.stepMark}>
              {done ? (
                <Feather name="check" size={16} color={domainColor} />
              ) : (
                <Text style={[type.label, { color: now ? domainColor : colors.subtle }]}>{i + 1}</Text>
              )}
            </View>
            <View style={s.stepText}>
              <Text style={[now ? type.bodyStrong : type.body, { color: done ? colors.mutedForeground : colors.foreground }]}>{step.title}</Text>
              {now || current == null ? (
                <Text style={[type.meta, { color: colors.mutedForeground }]}>{step.description}</Text>
              ) : null}
            </View>
            <Text style={[type.meta, { color: colors.mutedForeground }]}>{step.reward}</Text>
          </View>
        );
      })}
    </View>
  );
}

interface ChainSheetProps {
  /** A started chain (shows progress) or a catalog template (shows START). */
  chain: QuestChain | null;
  template: ChainTemplate | null;
  onClose: () => void;
  onStart?: (template: ChainTemplate) => void;
  alreadyStarted?: boolean;
  busy?: boolean;
}

export function ChainSheet({ chain, template, onClose, onStart, alreadyStarted = false, busy = false }: ChainSheetProps) {
  const colors = useColors();
  const subject = chain ?? template;
  if (!subject) return <Sheet visible={false} onClose={onClose}>{null}</Sheet>;
  const domainColor = DOMAIN_COLORS[subject.domain];

  return (
    <Sheet
      visible
      title={subject.name}
      onClose={onClose}
      footer={
        !chain && template && onStart ? (
          <Button
            label={alreadyStarted ? "Chain active" : "Start chain"}
            onPress={() => onStart(template)}
            disabled={alreadyStarted}
            loading={busy}
            block
          />
        ) : undefined
      }
    >
      <View style={s.metaRow}>
        <View style={[s.dot, { backgroundColor: domainColor }]} />
        <Text style={[type.meta, { color: colors.mutedForeground }]}>
          {chain
            ? `${chain.domain} · ${Math.min(chain.currentStep, chain.totalSteps)} of ${chain.totalSteps} steps done · ${STATUS_WORD[chain.status]}`
            : `${subject.domain} · ${subject.steps.length} steps`}
        </Text>
      </View>
      {subject.description ? <Text style={[type.body, { color: colors.foreground }]}>{subject.description}</Text> : null}
      <ChainSteps
        steps={subject.steps}
        current={chain ? chain.currentStep : undefined}
        finished={chain?.status === "complete"}
        domainColor={domainColor}
      />
    </Sheet>
  );
}

const s = StyleSheet.create({
  metaRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
  dot: { width: 8, height: 8, borderRadius: 4 },
  steps: { marginTop: space.sm },
  step: { flexDirection: "row", alignItems: "flex-start", gap: space.md, paddingVertical: space.sm + 4, borderBottomWidth: StyleSheet.hairlineWidth },
  stepMark: { width: 20, alignItems: "center", paddingTop: 3 },
  stepText: { flex: 1, gap: 2 },
});
