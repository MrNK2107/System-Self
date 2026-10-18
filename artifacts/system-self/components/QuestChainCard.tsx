import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import type { Domain, QuestChain } from "@/context/AppContext";
import { DOMAIN_COLORS, DOMAIN_GLYPHS as DOMAIN_ICONS } from "@/constants/domains";

interface Props {
  chain: QuestChain;
  onStart?: (chain: QuestChain) => void;
}

export function QuestChainCard({ chain, onStart }: Props) {
  const colors = useColors();
  const domColor = DOMAIN_COLORS[chain.domain];
  const domIcon = DOMAIN_ICONS[chain.domain];
  const isComplete = chain.status === "complete";
  const isAbandoned = chain.status === "abandoned";
  const progress = Math.min(chain.steps.length, chain.currentStep);

  return (
    <View style={[
      styles.card,
      {
        borderColor: isComplete ? domColor + "50" : isAbandoned ? colors.border : domColor + "30",
        backgroundColor: isComplete ? domColor + "08" : colors.card,
      },
    ]}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={[styles.domainIcon, { color: domColor }]}>{domIcon}</Text>
          <View>
            <Text style={[styles.chainName, { color: colors.foreground }]}>{chain.name}</Text>
            <Text style={[styles.chainDesc, { color: colors.mutedForeground }]} numberOfLines={1}>
              {chain.description}
            </Text>
          </View>
        </View>
        <View style={styles.headerRight}>
          {isComplete && (
            <View style={[styles.statusBadge, { borderColor: domColor + "50", backgroundColor: domColor + "10" }]}>
              <Feather name="check" size={9} color={domColor} />
              <Text style={[styles.statusText, { color: domColor }]}>COMPLETE</Text>
            </View>
          )}
          {isAbandoned && (
            <View style={[styles.statusBadge, { borderColor: colors.border }]}>
              <Text style={[styles.statusText, { color: colors.mutedForeground }]}>ABANDONED</Text>
            </View>
          )}
          {chain.status === "active" && (
            <View style={[styles.statusBadge, { borderColor: domColor + "40", backgroundColor: domColor + "08" }]}>
              <View style={[styles.activeDot, { backgroundColor: domColor }]} />
              <Text style={[styles.statusText, { color: domColor }]}>ACTIVE</Text>
            </View>
          )}
        </View>
      </View>

      {/* Progress bar */}
      <View style={[styles.progressTrack, { backgroundColor: colors.muted }]}>
        <View style={[styles.progressFill, {
          width: `${(progress / chain.steps.length) * 100}%` as `${number}%`,
          backgroundColor: isComplete ? domColor : domColor + "80",
        }]} />
      </View>

      {/* Steps */}
      <View style={styles.steps}>
        {chain.steps.map((step, i) => {
          const done = i < chain.currentStep;
          const current = i === chain.currentStep && chain.status === "active";
          return (
            <View key={i} style={styles.stepRow}>
              <View style={[
                styles.stepDot,
                {
                  backgroundColor: done ? domColor : current ? domColor + "40" : colors.muted,
                  borderColor: current ? domColor : "transparent",
                  borderWidth: current ? 1.5 : 0,
                },
              ]}>
                {done && <Feather name="check" size={7} color="#fff" />}
                {current && <View style={[styles.stepInner, { backgroundColor: domColor }]} />}
              </View>
              <View style={styles.stepContent}>
                <Text style={[
                  styles.stepTitle,
                  { color: done ? colors.mutedForeground : current ? colors.foreground : colors.mutedForeground },
                ]}>{step.title}</Text>
                {current && (
                  <Text style={[styles.stepDesc, { color: colors.mutedForeground }]} numberOfLines={2}>
                    {step.description}
                  </Text>
                )}
              </View>
              <Text style={[styles.stepReward, { color: domColor }]}>{step.reward}</Text>
            </View>
          );
        })}
      </View>

      {/* Step counter */}
      <Text style={[styles.counter, { color: colors.mutedForeground }]}>
        STEP {Math.min(chain.steps.length, chain.currentStep + (chain.status === "active" ? 1 : 0))} OF {chain.steps.length}
      </Text>
    </View>
  );
}

// Card for catalog (before starting)
export function QuestChainCatalogCard({
  chain, onStart, alreadyStarted,
}: {
  chain: Omit<QuestChain, "id" | "startedAt" | "currentStep" | "status">;
  onStart: () => void;
  alreadyStarted: boolean;
}) {
  const colors = useColors();
  const domColor = DOMAIN_COLORS[chain.domain];
  const domIcon = DOMAIN_ICONS[chain.domain];

  return (
    <View style={[styles.card, { borderColor: domColor + "25", backgroundColor: colors.card }]}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={[styles.domainIcon, { color: domColor }]}>{domIcon}</Text>
          <View style={{ flex: 1 }}>
            <Text style={[styles.chainName, { color: colors.foreground }]}>{chain.name}</Text>
            <Text style={[styles.chainDesc, { color: colors.mutedForeground }]}>{chain.description}</Text>
          </View>
        </View>
        <Text style={[styles.stepCountBadge, { color: domColor, borderColor: domColor + "40" }]}>
          {chain.steps.length} STEPS
        </Text>
      </View>

      <View style={styles.catalogSteps}>
        {chain.steps.map((step, i) => (
          <View key={i} style={styles.catalogStep}>
            <Text style={[styles.stepNum, { color: domColor + "80" }]}>{i + 1}.</Text>
            <Text style={[styles.stepTitleSm, { color: colors.mutedForeground }]}>{step.title}</Text>
            <Text style={[styles.stepRewardSm, { color: domColor }]}>{step.reward}</Text>
          </View>
        ))}
      </View>

      <Pressable
        style={({ pressed }) => [
          styles.startBtn,
          {
            borderColor: alreadyStarted ? colors.border : domColor + "60",
            backgroundColor: alreadyStarted ? "transparent" : domColor + "10",
            opacity: pressed ? 0.7 : 1,
          },
        ]}
        onPress={onStart}
        disabled={alreadyStarted}
      >
        <Text style={[styles.startBtnText, { color: alreadyStarted ? colors.mutedForeground : domColor }]}>
          {alreadyStarted ? "CHAIN ACTIVE" : "START CHAIN"}
        </Text>
        {!alreadyStarted && <Feather name="chevron-right" size={12} color={domColor} />}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 6, padding: 14, gap: 12 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 8 },
  headerLeft: { flexDirection: "row", alignItems: "flex-start", gap: 10, flex: 1 },
  headerRight: {},
  domainIcon: { fontSize: 14, marginTop: 1 },
  chainName: { fontSize: 13, fontWeight: "700" as const, letterSpacing: 0.3 },
  chainDesc: { fontSize: 10, lineHeight: 15, marginTop: 2 },
  statusBadge: {
    flexDirection: "row", alignItems: "center", gap: 5,
    borderWidth: 1, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 3,
  },
  statusText: { fontSize: 7, fontWeight: "800" as const, letterSpacing: 1.5 },
  activeDot: { width: 5, height: 5, borderRadius: 2.5 },
  progressTrack: { height: 2, borderRadius: 1, overflow: "hidden" },
  progressFill: { height: "100%", borderRadius: 1 },
  steps: { gap: 10 },
  stepRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  stepDot: {
    width: 14, height: 14, borderRadius: 7,
    alignItems: "center", justifyContent: "center", marginTop: 1,
  },
  stepInner: { width: 5, height: 5, borderRadius: 2.5 },
  stepContent: { flex: 1 },
  stepTitle: { fontSize: 11, fontWeight: "600" as const, letterSpacing: 0.3 },
  stepDesc: { fontSize: 10, lineHeight: 15, marginTop: 3 },
  stepReward: { fontSize: 9, fontWeight: "800" as const, letterSpacing: 1 },
  counter: { fontSize: 8, letterSpacing: 2, fontWeight: "600" as const, textAlign: "right" },
  stepCountBadge: {
    fontSize: 8, fontWeight: "800" as const, letterSpacing: 2,
    borderWidth: 1, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 2,
  },
  catalogSteps: { gap: 7 },
  catalogStep: { flexDirection: "row", alignItems: "center", gap: 8 },
  stepNum: { fontSize: 9, fontWeight: "700" as const, width: 14 },
  stepTitleSm: { fontSize: 10, flex: 1 },
  stepRewardSm: { fontSize: 9, fontWeight: "700" as const, letterSpacing: 0.5 },
  startBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 6, borderWidth: 1, borderRadius: 3, paddingVertical: 10,
  },
  startBtnText: { fontSize: 10, fontWeight: "800" as const, letterSpacing: 2.5 },
});
