import React from "react";
import {
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useApp, type Rival } from "@/context/AppContext";
import { DomainBar } from "@/components/DomainBar";
import { RankBadge } from "@/components/RankBadge";

function RivalCard({ rival, userScores }: {
  rival: Rival;
  userScores: { BODY: number; MIND: number; WEALTH: number; DISCIPLINE: number };
}) {
  const colors = useColors();

  const trajectoryIcon = rival.trajectory === "up" ? "↑" : rival.trajectory === "down" ? "↓" : "→";
  const trajectoryColor = rival.trajectory === "up" ? colors.primary : rival.trajectory === "down" ? colors.destructive : colors.mutedForeground;

  const rivalDomains = [
    { domain: "BODY" as const, score: rival.bodyScore, userScore: userScores.BODY },
    { domain: "MIND" as const, score: rival.mindScore, userScore: userScores.MIND },
    { domain: "WEALTH" as const, score: rival.wealthScore, userScore: userScores.WEALTH },
    { domain: "DISCIPLINE" as const, score: rival.disciplineScore, userScore: userScores.DISCIPLINE },
  ];

  return (
    <View style={[styles.rivalCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.rivalHeader}>
        <View>
          <Text style={[styles.codename, { color: colors.foreground }]}>{rival.codename}</Text>
          {rival.shadowActive && (
            <View style={[styles.shadowTag, { borderColor: colors.destructive + "60" }]}>
              <Text style={[styles.shadowTagText, { color: colors.destructive }]}>SHADOW ACTIVE</Text>
            </View>
          )}
        </View>
        <View style={styles.rivalRight}>
          <Text style={[styles.trajectory, { color: trajectoryColor }]}>{trajectoryIcon}</Text>
          <RankBadge rank={rival.rank} size="sm" />
        </View>
      </View>

      <View style={[styles.divider, { backgroundColor: colors.border }]} />

      <View style={styles.domainsGrid}>
        {rivalDomains.map(({ domain, score, userScore }) => {
          const diff = score - userScore;
          const diffColor = diff > 0 ? colors.destructive : diff < 0 ? colors.primary : colors.mutedForeground;
          return (
            <View key={domain} style={styles.domainCompare}>
              <View style={styles.domainCompareHeader}>
                <Text style={[styles.domainLabel, { color: colors.mutedForeground }]}>{domain}</Text>
                <View style={styles.diffRow}>
                  <Text style={[styles.rivalScore, { color: colors.foreground, fontFamily: "SpaceMono" }]}>
                    {score.toFixed(1)}
                  </Text>
                  <Text style={[styles.diffBadge, { color: diffColor }]}>
                    {diff > 0 ? `+${diff.toFixed(1)}` : diff.toFixed(1)}
                  </Text>
                </View>
              </View>
              <View style={[styles.compareTrack, { backgroundColor: colors.muted }]}>
                <View style={[styles.rivalFill, {
                  width: `${score}%` as any,
                  backgroundColor: colors.domain[domain] + "60",
                }]} />
                <View style={[styles.userMarker, {
                  left: `${userScore}%` as any,
                  backgroundColor: colors.primary,
                }]} />
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

export default function RivalsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { rivals, domainScores, user } = useApp();

  const userScores = {
    BODY: domainScores.find(s => s.domain === "BODY")?.score ?? 50,
    MIND: domainScores.find(s => s.domain === "MIND")?.score ?? 50,
    WEALTH: domainScores.find(s => s.domain === "WEALTH")?.score ?? 50,
    DISCIPLINE: domainScores.find(s => s.domain === "DISCIPLINE")?.score ?? 50,
  };

  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: topPad + 16, paddingBottom: insets.bottom + 80 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Text style={[styles.title, { color: colors.foreground }]}>RIVALS</Text>
          <Text style={[styles.count, { color: colors.mutedForeground }]}>{rivals.length} ASSIGNED</Text>
        </View>

        <View style={[styles.infoCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Feather name="eye-off" size={14} color={colors.mutedForeground} />
          <Text style={[styles.infoText, { color: colors.mutedForeground }]}>
            Rivals are anonymous. You see their scores, not their identity. They can see yours.
          </Text>
        </View>

        {rivals.map(rival => (
          <RivalCard key={rival.codename} rival={rival} userScores={userScores} />
        ))}

        <View style={[styles.yourStats, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>YOUR POSITION</Text>
          {domainScores.map(ds => (
            <DomainBar key={ds.domain} domain={ds.domain} score={ds.score} streak={ds.streak} />
          ))}
        </View>

        <View style={[styles.upgradeCard, { borderColor: colors.primary + "40", backgroundColor: colors.primary + "08" }]}>
          <Text style={[styles.upgradeTitle, { color: colors.primary }]}>NAMED CHALLENGES</Text>
          <Text style={[styles.upgradeText, { color: colors.mutedForeground }]}>
            Issue direct challenges to rivals with specified domains and timeframes. Available in PRO.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { paddingHorizontal: 20, gap: 12 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  title: {
    fontSize: 14,
    fontWeight: "700" as const,
    letterSpacing: 3,
  },
  count: {
    fontSize: 9,
    letterSpacing: 2,
    fontWeight: "600" as const,
  },
  infoCard: {
    flexDirection: "row",
    gap: 10,
    padding: 12,
    borderRadius: 4,
    borderWidth: 1,
    alignItems: "flex-start",
  },
  infoText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
  },
  rivalCard: {
    padding: 16,
    borderRadius: 4,
    borderWidth: 1,
    gap: 12,
  },
  rivalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  codename: {
    fontSize: 14,
    fontWeight: "700" as const,
    letterSpacing: 1,
  },
  shadowTag: {
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 2,
    marginTop: 4,
    alignSelf: "flex-start",
  },
  shadowTagText: {
    fontSize: 8,
    fontWeight: "700" as const,
    letterSpacing: 2,
  },
  rivalRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  trajectory: {
    fontSize: 18,
    fontWeight: "700" as const,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
  },
  domainsGrid: {
    gap: 10,
  },
  domainCompare: {
    gap: 5,
  },
  domainCompareHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  domainLabel: {
    fontSize: 9,
    letterSpacing: 2,
    fontWeight: "600" as const,
  },
  diffRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  rivalScore: {
    fontSize: 12,
    fontWeight: "700" as const,
  },
  diffBadge: {
    fontSize: 10,
    fontWeight: "700" as const,
  },
  compareTrack: {
    height: 4,
    borderRadius: 2,
    overflow: "visible",
    position: "relative",
  },
  rivalFill: {
    position: "absolute",
    left: 0,
    top: 0,
    height: "100%",
    borderRadius: 2,
  },
  userMarker: {
    position: "absolute",
    top: -2,
    width: 2,
    height: 8,
    borderRadius: 1,
    marginLeft: -1,
  },
  yourStats: {
    padding: 16,
    borderRadius: 4,
    borderWidth: 1,
    gap: 12,
  },
  sectionLabel: {
    fontSize: 9,
    letterSpacing: 3,
    fontWeight: "600" as const,
  },
  upgradeCard: {
    padding: 14,
    borderRadius: 4,
    borderWidth: 1,
    gap: 6,
  },
  upgradeTitle: {
    fontSize: 10,
    fontWeight: "700" as const,
    letterSpacing: 2,
  },
  upgradeText: {
    fontSize: 12,
    lineHeight: 18,
  },
});
