import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Animated,
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
import { useApp, type Domain } from "@/context/AppContext";
import { DomainBar } from "@/components/DomainBar";
import { RankBadge } from "@/components/RankBadge";
import { SystemMessage } from "@/components/SystemMessage";
import { LogModal } from "@/components/LogModal";
import { useSystemAI } from "@/hooks/useSystemAI";
import { RankUpModal } from "@/components/RankUpModal";

const DOMAIN_COLORS: Record<Domain, string> = {
  BODY: "#E05555",
  MIND: "#3A7BD5",
  WEALTH: "#4B8B6F",
  DISCIPLINE: "#C4873A",
};
const ALL_DOMAINS: Domain[] = ["BODY", "MIND", "WEALTH", "DISCIPLINE"];

function ShadowAlertBanner() {
  const colors = useColors();
  const { shadowSelf, domainScores, getShadowScores } = useApp();
  const pulseAnim = React.useRef(new Animated.Value(0.4)).current;

  React.useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1, duration: 1600, useNativeDriver: false }),
        Animated.timing(pulseAnim, { toValue: 0.4, duration: 1600, useNativeDriver: false }),
      ])
    ).start();
  }, []);

  const shadowScores = getShadowScores();
  const losingDomains = ALL_DOMAINS.filter(d => {
    const user = domainScores.find(s => s.domain === d)?.score ?? 50;
    return shadowScores[d] > user;
  });
  const isLosing = losingDomains.length > 0;
  const gap = shadowSelf.gap;

  return (
    <View style={[
      shadowStyles.container,
      {
        borderColor: isLosing ? "#E0555550" : "#4B8B6F40",
        backgroundColor: isLosing ? "#E0555508" : "#4B8B6F08",
      },
    ]}>
      <View style={shadowStyles.topRow}>
        <View style={shadowStyles.left}>
          <Animated.View style={[shadowStyles.dot, { opacity: pulseAnim, backgroundColor: isLosing ? "#E05555" : "#4B8B6F" }]} />
          <Text style={[shadowStyles.label, { color: isLosing ? "#E05555" : "#4B8B6F" }]}>
            SHADOW SELF
          </Text>
        </View>
        <Text style={[shadowStyles.codename, { color: colors.mutedForeground }]}>
          {shadowSelf.codename}
        </Text>
      </View>
      <Text style={[shadowStyles.status, { color: isLosing ? "#E05555" : "#4B8B6F" }]}>
        {isLosing
          ? `${Math.abs(gap).toFixed(1)} pts ahead. ${losingDomains.length} domain${losingDomains.length > 1 ? "s" : ""} compromised: ${losingDomains.join(" · ")}`
          : `You are ${Math.abs(gap).toFixed(1)} pts ahead. Stay consistent.`}
      </Text>
      {isLosing && (
        <View style={shadowStyles.domainRow}>
          {ALL_DOMAINS.map(d => {
            const user = domainScores.find(s => s.domain === d)?.score ?? 50;
            const shadow = shadowScores[d];
            const losing = shadow > user;
            const color = DOMAIN_COLORS[d];
            return (
              <View key={d} style={shadowStyles.domainCell}>
                <Text style={[shadowStyles.dLabel, { color: losing ? color : "#2A2D38" }]}>{d.slice(0, 4)}</Text>
                <Text style={[shadowStyles.dDiff, { color: losing ? "#E05555" : "#4B8B6F" }]}>
                  {losing ? `−${(shadow - user).toFixed(1)}` : `+${(user - shadow).toFixed(1)}`}
                </Text>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

const shadowStyles = StyleSheet.create({
  container: {
    borderWidth: 1,
    borderRadius: 6,
    padding: 12,
    gap: 8,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  left: { flexDirection: "row", alignItems: "center", gap: 7 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  label: { fontSize: 9, fontWeight: "800" as const, letterSpacing: 3 },
  codename: { fontSize: 9, letterSpacing: 1 },
  status: { fontSize: 11, lineHeight: 17, fontWeight: "600" as const },
  domainRow: { flexDirection: "row", gap: 8, marginTop: 2 },
  domainCell: { flex: 1, alignItems: "center", gap: 2 },
  dLabel: { fontSize: 8, fontWeight: "700" as const, letterSpacing: 1.5 },
  dDiff: { fontSize: 11, fontWeight: "800" as const },
});

export default function Dashboard() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user, domainScores, quests, shadowSelf, trajectory, getHiddenScore, computeRank, getShadowScores, pendingRankUp, acknowledgeRankUp } = useApp();
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
      {pendingRankUp && (
        <RankUpModal
          visible={!!pendingRankUp}
          fromRank={pendingRankUp.fromRank}
          toRank={pendingRankUp.toRank}
          newCodename={pendingRankUp.newCodename}
          onAcknowledge={acknowledgeRankUp}
        />
      )}
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

        {/* Shadow Self Alert */}
        {shadowSelf.active && <ShadowAlertBanner />}
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
