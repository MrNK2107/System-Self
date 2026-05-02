import React, { useState } from "react";
import {
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";
import { DomainBar } from "@/components/DomainBar";
import { RankBadge } from "@/components/RankBadge";
import { useSystemAI } from "@/hooks/useSystemAI";
import { SystemMessage } from "@/components/SystemMessage";

export default function StatsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user, domainScores, shadowSelf, logs, quests, trajectory, getHiddenScore, computeRank, resetAll } = useApp();
  const { generateMessage, loading } = useSystemAI();
  const [debrief, setDebrief] = useState("");
  const [debriefLoading, setDebriefLoading] = useState(false);
  const [showReset, setShowReset] = useState(false);

  const hiddenScore = getHiddenScore();
  const rank = user?.rank ?? computeRank(hiddenScore);
  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);

  const completedQuests = quests.filter(q => q.status === "complete").length;
  const totalLogs = logs.length;

  const rankThresholds: Record<string, { min: number; max: number }> = {
    E: { min: 0, max: 25 }, D: { min: 26, max: 40 },
    C: { min: 41, max: 55 }, B: { min: 56, max: 70 },
    A: { min: 71, max: 85 }, S: { min: 86, max: 100 },
  };
  const threshold = rankThresholds[rank];
  const nextRank = rank === "B" ? null : ({ E: "D", D: "C", C: "B", B: "A", A: "S" } as Record<string, string>)[rank];
  const progressToNext = threshold ? ((hiddenScore - threshold.min) / (threshold.max - threshold.min)) * 100 : 100;

  const requestDebrief = async () => {
    if (!user || debriefLoading) return;
    setDebriefLoading(true);
    const scores = {
      BODY: domainScores.find(s => s.domain === "BODY")?.score ?? 50,
      MIND: domainScores.find(s => s.domain === "MIND")?.score ?? 50,
      WEALTH: domainScores.find(s => s.domain === "WEALTH")?.score ?? 50,
      DISCIPLINE: domainScores.find(s => s.domain === "DISCIPLINE")?.score ?? 50,
    };
    const msg = await generateMessage({
      messageType: "nightly_debrief",
      username: user.username,
      rank,
      domainScores: scores,
      trajectory,
      shadowActive: shadowSelf.active,
      shadowGap: shadowSelf.gap,
      questCount: quests.length,
      completedQuestCount: completedQuests,
      primaryGoal: user.primaryGoal,
      dayNumber: user.dayNumber,
    });
    setDebrief(msg);
    setDebriefLoading(false);
  };

  if (!user) return null;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: topPad + 16, paddingBottom: insets.bottom + 80 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Profile Header */}
        <View style={[styles.profileCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.profileTop}>
            <View>
              <Text style={[styles.systemLabel, { color: colors.mutedForeground }]}>SYSTEM // SELF</Text>
              <Text style={[styles.username, { color: colors.foreground }]}>{user.username}</Text>
              <Text style={[styles.goal, { color: colors.mutedForeground }]} numberOfLines={2}>
                {user.primaryGoal}
              </Text>
            </View>
            <RankBadge rank={rank} size="lg" showLabel />
          </View>

          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <Text style={[styles.statValue, { color: colors.foreground, fontFamily: "SpaceMono" }]}>
                {user.dayNumber}
              </Text>
              <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>DAYS</Text>
            </View>
            <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
            <View style={styles.statItem}>
              <Text style={[styles.statValue, { color: colors.foreground, fontFamily: "SpaceMono" }]}>
                {totalLogs}
              </Text>
              <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>LOGS</Text>
            </View>
            <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
            <View style={styles.statItem}>
              <Text style={[styles.statValue, { color: colors.foreground, fontFamily: "SpaceMono" }]}>
                {completedQuests}
              </Text>
              <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>QUESTS</Text>
            </View>
          </View>

          {/* Rank Progress */}
          {nextRank && (
            <View style={styles.rankProgress}>
              <View style={styles.rankProgressHeader}>
                <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>RANK PROGRESS → {nextRank}</Text>
                <Text style={[styles.progressPct, { color: colors.primary, fontFamily: "SpaceMono" }]}>
                  {Math.min(100, Math.round(progressToNext))}%
                </Text>
              </View>
              <View style={[styles.progressTrack, { backgroundColor: colors.muted }]}>
                <View style={[styles.progressFill, {
                  width: `${Math.min(100, progressToNext)}%` as any,
                  backgroundColor: colors.primary,
                }]} />
              </View>
              <Text style={[styles.progressNote, { color: colors.mutedForeground }]}>
                Requires 14 consecutive days at next tier
              </Text>
            </View>
          )}
        </View>

        {/* Domain Scores */}
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>DOMAIN SCORES</Text>
          {domainScores.map(ds => (
            <DomainBar
              key={ds.domain}
              domain={ds.domain}
              score={ds.score}
              streak={ds.streak}
              showStreak
            />
          ))}
        </View>

        {/* Shadow Self */}
        {shadowSelf.active && (
          <View style={[styles.shadowCard, { borderColor: colors.destructive + "60", backgroundColor: colors.destructive + "08" }]}>
            <View style={styles.shadowHeader}>
              <Text style={[styles.shadowTitle, { color: colors.destructive }]}>SHADOW SELF — DIVERGENCE</Text>
              <Text style={[styles.shadowGap, { color: colors.destructive, fontFamily: "SpaceMono" }]}>
                {shadowSelf.gap.toFixed(1)} PTS
              </Text>
            </View>
            <Text style={[styles.shadowText, { color: colors.mutedForeground }]}>
              Active since {shadowSelf.activatedAt ? new Date(shadowSelf.activatedAt).toLocaleDateString() : "unknown"}.
              Surpass it across all domains to deactivate.
            </Text>
          </View>
        )}

        {/* Nightly Debrief */}
        <TouchableOpacity
          style={[styles.debriefBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
          onPress={requestDebrief}
          activeOpacity={0.8}
          disabled={debriefLoading}
        >
          <Feather name="moon" size={16} color={colors.mutedForeground} />
          <Text style={[styles.debriefBtnText, { color: colors.mutedForeground }]}>
            {debriefLoading ? "GENERATING VERDICT..." : "REQUEST NIGHTLY DEBRIEF"}
          </Text>
        </TouchableOpacity>

        {debrief ? (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <SystemMessage message={debrief} animate label="NIGHTLY DEBRIEF" />
          </View>
        ) : null}

        {/* Settings */}
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>SETTINGS</Text>
          <View style={styles.settingRow}>
            <Feather name="eye" size={14} color={colors.mutedForeground} />
            <Text style={[styles.settingLabel, { color: colors.foreground }]}>Identity</Text>
            <Text style={[styles.settingValue, { color: colors.mutedForeground }]}>
              {user.identitySetting.toUpperCase()}
            </Text>
          </View>
          <View style={[styles.separator, { backgroundColor: colors.border }]} />
          <View style={styles.settingRow}>
            <Feather name="sun" size={14} color={colors.mutedForeground} />
            <Text style={[styles.settingLabel, { color: colors.foreground }]}>Morning Briefing</Text>
            <Text style={[styles.settingValue, { color: colors.mutedForeground }]}>{user.morningTime}</Text>
          </View>
          <View style={[styles.separator, { backgroundColor: colors.border }]} />
          <View style={styles.settingRow}>
            <Feather name="moon" size={14} color={colors.mutedForeground} />
            <Text style={[styles.settingLabel, { color: colors.foreground }]}>Nightly Debrief</Text>
            <Text style={[styles.settingValue, { color: colors.mutedForeground }]}>{user.nightlyTime}</Text>
          </View>
          <View style={[styles.separator, { backgroundColor: colors.border }]} />
          <TouchableOpacity
            style={styles.settingRow}
            onPress={() => setShowReset(r => !r)}
            activeOpacity={0.7}
          >
            <Feather name="rotate-ccw" size={14} color={colors.destructive} />
            <Text style={[styles.settingLabel, { color: colors.destructive }]}>Reset All Data</Text>
            <Feather name="chevron-right" size={14} color={colors.destructive} />
          </TouchableOpacity>
          {showReset && (
            <TouchableOpacity
              style={[styles.resetConfirm, { backgroundColor: colors.destructive + "20", borderColor: colors.destructive }]}
              onPress={resetAll}
              activeOpacity={0.8}
            >
              <Text style={[styles.resetConfirmText, { color: colors.destructive }]}>
                CONFIRM RESET — ALL DATA WILL BE LOST
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { paddingHorizontal: 20, gap: 12 },
  profileCard: {
    padding: 16,
    borderRadius: 4,
    borderWidth: 1,
    gap: 16,
  },
  profileTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  systemLabel: {
    fontSize: 9,
    letterSpacing: 3,
    fontWeight: "600" as const,
    marginBottom: 2,
  },
  username: {
    fontSize: 22,
    fontWeight: "700" as const,
    letterSpacing: 1,
  },
  goal: {
    fontSize: 12,
    lineHeight: 18,
    marginTop: 4,
    maxWidth: 180,
  },
  statsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 0,
  },
  statItem: {
    flex: 1,
    alignItems: "center",
    gap: 2,
  },
  statValue: {
    fontSize: 20,
    fontWeight: "700" as const,
  },
  statLabel: {
    fontSize: 9,
    letterSpacing: 2,
    fontWeight: "600" as const,
  },
  statDivider: {
    width: 1,
    height: 32,
  },
  rankProgress: {
    gap: 6,
  },
  rankProgressHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  progressPct: {
    fontSize: 12,
    fontWeight: "700" as const,
  },
  progressTrack: {
    height: 2,
    borderRadius: 1,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 1,
  },
  progressNote: {
    fontSize: 9,
    letterSpacing: 1,
  },
  card: {
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
  shadowCard: {
    padding: 14,
    borderRadius: 4,
    borderWidth: 1,
    gap: 8,
  },
  shadowHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  shadowTitle: {
    fontSize: 10,
    fontWeight: "700" as const,
    letterSpacing: 2,
  },
  shadowGap: {
    fontSize: 14,
    fontWeight: "700" as const,
  },
  shadowText: {
    fontSize: 12,
    lineHeight: 18,
  },
  debriefBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: 14,
    borderRadius: 4,
    borderWidth: 1,
  },
  debriefBtnText: {
    fontSize: 10,
    letterSpacing: 2,
    fontWeight: "600" as const,
  },
  settingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  settingLabel: {
    flex: 1,
    fontSize: 13,
  },
  settingValue: {
    fontSize: 11,
    letterSpacing: 1,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
  },
  resetConfirm: {
    padding: 12,
    borderRadius: 2,
    borderWidth: 1,
    alignItems: "center",
  },
  resetConfirmText: {
    fontSize: 10,
    fontWeight: "700" as const,
    letterSpacing: 1.5,
    textAlign: "center",
  },
});
