import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";
import { DomainBar } from "@/components/DomainBar";
import { RankBadge } from "@/components/RankBadge";
import { SystemMessage } from "@/components/SystemMessage";
import { LogModal } from "@/components/LogModal";
import { useSystemAI } from "@/hooks/useSystemAI";

export default function Dashboard() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user, domainScores, quests, shadowSelf, trajectory, getHiddenScore, computeRank } = useApp();
  const { generateMessage, loading: aiLoading } = useSystemAI();

  const [briefing, setBriefing] = useState<string>("");
  const [briefingLoaded, setBriefingLoaded] = useState(false);
  const [logVisible, setLogVisible] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const hiddenScore = getHiddenScore();
  const rank = user?.rank ?? computeRank(hiddenScore);
  const activeQuests = quests.filter(q => q.status === "active");
  const completedToday = quests.filter(q => q.status === "complete").length;

  const loadBriefing = useCallback(async () => {
    if (!user || briefingLoaded) return;
    const scores: { BODY: number; MIND: number; WEALTH: number; DISCIPLINE: number } = {
      BODY: domainScores.find(s => s.domain === "BODY")?.score ?? 50,
      MIND: domainScores.find(s => s.domain === "MIND")?.score ?? 50,
      WEALTH: domainScores.find(s => s.domain === "WEALTH")?.score ?? 50,
      DISCIPLINE: domainScores.find(s => s.domain === "DISCIPLINE")?.score ?? 50,
    };
    const msg = await generateMessage({
      messageType: "morning_briefing",
      username: user.username,
      rank,
      domainScores: scores,
      trajectory,
      shadowActive: shadowSelf.active,
      shadowGap: shadowSelf.gap,
      questCount: activeQuests.length,
      completedQuestCount: completedToday,
      primaryGoal: user.primaryGoal,
      dayNumber: user.dayNumber,
    });
    setBriefing(msg);
    setBriefingLoaded(true);
  }, [user, briefingLoaded, domainScores, trajectory, shadowSelf, activeQuests.length, completedToday, rank]);

  useEffect(() => {
    loadBriefing();
  }, [loadBriefing]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    setBriefingLoaded(false);
    await loadBriefing();
    setRefreshing(false);
  }, [loadBriefing]);

  if (!user) return null;

  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: topPad + 16, paddingBottom: insets.bottom + 80 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
          />
        }
      >
        {/* Header */}
        <View style={styles.headerRow}>
          <View>
            <Text style={[styles.systemLabel, { color: colors.mutedForeground }]}>SYSTEM // SELF</Text>
            <Text style={[styles.username, { color: colors.foreground }]}>{user.username}</Text>
          </View>
          <View style={styles.headerRight}>
            {shadowSelf.active && (
              <View style={[styles.shadowBadge, { borderColor: colors.destructive }]}>
                <Text style={[styles.shadowBadgeText, { color: colors.destructive }]}>SHADOW</Text>
              </View>
            )}
            <RankBadge rank={rank} size="md" />
          </View>
        </View>

        {/* Trajectory */}
        <View style={[styles.trajectoryRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.metricLabel, { color: colors.mutedForeground }]}>TRAJECTORY</Text>
          <Text style={[
            styles.trajectoryValue,
            {
              color: trajectory === "up" ? colors.primary :
                trajectory === "down" ? colors.destructive :
                colors.mutedForeground,
              fontFamily: "SpaceMono",
            }
          ]}>
            {trajectory === "up" ? "↑ CLIMBING" : trajectory === "down" ? "↓ FALLING" : "→ STABLE"}
          </Text>
          <View style={styles.divider} />
          <Text style={[styles.metricLabel, { color: colors.mutedForeground }]}>DAY</Text>
          <Text style={[styles.metricValue, { color: colors.foreground, fontFamily: "SpaceMono" }]}>
            {user.dayNumber}
          </Text>
        </View>

        {/* SYSTEM Briefing */}
        <View style={[styles.briefingCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>MORNING BRIEFING</Text>
          {aiLoading && !briefing ? (
            <ActivityIndicator color={colors.primary} size="small" />
          ) : briefing ? (
            <SystemMessage message={briefing} animate={!refreshing} label="THE SYSTEM" />
          ) : (
            <Text style={[styles.placeholder, { color: colors.mutedForeground }]}>Loading transmission...</Text>
          )}
        </View>

        {/* Domain Scores */}
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>STAT DOMAINS</Text>
          <View style={styles.domainsContainer}>
            {domainScores.map(ds => (
              <DomainBar
                key={ds.domain}
                domain={ds.domain}
                score={ds.score}
                streak={ds.streak}
              />
            ))}
          </View>
        </View>

        {/* Active Quests Summary */}
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.cardHeader}>
            <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>ACTIVE QUESTS</Text>
            <Text style={[styles.questCount, { color: colors.primary, fontFamily: "SpaceMono" }]}>
              {completedToday}/{quests.length}
            </Text>
          </View>
          {activeQuests.length === 0 ? (
            <Text style={[styles.placeholder, { color: colors.mutedForeground }]}>
              No active quests. Check the Quest Board.
            </Text>
          ) : (
            activeQuests.slice(0, 3).map(q => (
              <View key={q.id} style={[styles.questRow, { borderColor: colors.border }]}>
                <View style={[styles.questDot, { backgroundColor: colors.domain[q.domain as keyof typeof colors.domain] ?? colors.primary }]} />
                <Text style={[styles.questTitle, { color: colors.foreground }]} numberOfLines={1}>
                  {q.title}
                </Text>
              </View>
            ))
          )}
        </View>

        {/* Shadow Self */}
        {shadowSelf.active && (
          <View style={[styles.shadowCard, { borderColor: colors.destructive + "60", backgroundColor: colors.destructive + "10" }]}>
            <Text style={[styles.shadowTitle, { color: colors.destructive }]}>SHADOW SELF — ACTIVE</Text>
            <Text style={[styles.shadowText, { color: colors.mutedForeground }]}>
              Divergence: {shadowSelf.gap.toFixed(1)} points. It will not wait for you.
            </Text>
          </View>
        )}
      </ScrollView>

      {/* Log FAB */}
      <TouchableOpacity
        style={[styles.fab, { backgroundColor: colors.primary, bottom: insets.bottom + 72 }]}
        onPress={() => setLogVisible(true)}
        activeOpacity={0.85}
      >
        <Feather name="plus" size={22} color="#fff" />
      </TouchableOpacity>

      <LogModal visible={logVisible} onClose={() => setLogVisible(false)} />
    </View>
  );
}

import { Platform } from "react-native";

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { paddingHorizontal: 20, gap: 12 },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  systemLabel: {
    fontSize: 9,
    letterSpacing: 3,
    fontWeight: "600" as const,
    marginBottom: 2,
  },
  username: {
    fontSize: 20,
    fontWeight: "700" as const,
    letterSpacing: 1,
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  shadowBadge: {
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 2,
  },
  shadowBadgeText: {
    fontSize: 8,
    fontWeight: "700" as const,
    letterSpacing: 2,
  },
  trajectoryRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    borderRadius: 4,
    borderWidth: 1,
    gap: 10,
  },
  divider: {
    width: 1,
    height: 16,
    backgroundColor: "#2A2D38",
  },
  metricLabel: {
    fontSize: 9,
    letterSpacing: 2,
    fontWeight: "600" as const,
  },
  metricValue: {
    fontSize: 14,
    fontWeight: "700" as const,
  },
  trajectoryValue: {
    fontSize: 11,
    fontWeight: "700" as const,
    letterSpacing: 1,
    flex: 1,
  },
  briefingCard: {
    padding: 16,
    borderRadius: 4,
    borderWidth: 1,
    gap: 12,
    minHeight: 80,
    justifyContent: "center",
  },
  card: {
    padding: 16,
    borderRadius: 4,
    borderWidth: 1,
    gap: 12,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  sectionLabel: {
    fontSize: 9,
    letterSpacing: 3,
    fontWeight: "600" as const,
  },
  domainsContainer: {
    gap: 14,
  },
  questCount: {
    fontSize: 13,
    fontWeight: "700" as const,
  },
  questRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  questDot: {
    width: 6,
    height: 6,
    borderRadius: 1,
  },
  questTitle: {
    fontSize: 12,
    flex: 1,
  },
  placeholder: {
    fontSize: 12,
    fontStyle: "italic",
  },
  shadowCard: {
    padding: 14,
    borderRadius: 4,
    borderWidth: 1,
    gap: 6,
  },
  shadowTitle: {
    fontSize: 10,
    fontWeight: "700" as const,
    letterSpacing: 2,
  },
  shadowText: {
    fontSize: 12,
    lineHeight: 18,
  },
  fab: {
    position: "absolute",
    right: 20,
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
});
