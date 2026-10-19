import React, { useState } from "react";
import {
  Animated,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useQuery } from "@tanstack/react-query";
import { useApp, ACHIEVEMENT_DEFS, type Domain } from "@/context/AppContext";
import { useGameUserId } from "@/hooks/useGameState";
import { api } from "@/lib/api/client";
import { weeklyDebriefKey, weeklyRecapKey } from "@/lib/game/keys";
import { fetchWeeklyDebrief, fetchWeeklyRecap } from "@/lib/game/messages";
import { SystemMessage } from "@/components/SystemMessage";
import { ScreenStatus } from "@/components/ScreenStatus";
import { ALL_DOMAINS as DOMAINS, DOMAIN_COLORS, DOMAIN_GLYPHS as DOMAIN_ICONS } from "@/constants/domains";

function DeltaBar({ domain, delta, max }: { domain: Domain; delta: number; max: number }) {
  const colors = useColors();
  const domColor = DOMAIN_COLORS[domain];
  const pct = max > 0 ? (delta / max) * 100 : 0;
  return (
    <View style={deltaStyles.row}>
      <Text style={[deltaStyles.icon, { color: domColor }]}>{DOMAIN_ICONS[domain]}</Text>
      <Text style={[deltaStyles.label, { color: colors.mutedForeground }]}>{domain}</Text>
      <View style={[deltaStyles.track, { backgroundColor: colors.muted }]}>
        <View style={[deltaStyles.fill, { width: `${pct}%` as `${number}%`, backgroundColor: domColor }]} />
      </View>
      <Text style={[deltaStyles.value, { color: delta > 0 ? domColor : colors.mutedForeground, fontFamily: "SpaceMono" }]}>
        {delta > 0 ? `+${delta.toFixed(1)}` : delta.toFixed(1)}
      </Text>
    </View>
  );
}

const deltaStyles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  icon: { fontSize: 10 },
  label: { width: 70, fontSize: 9, fontWeight: "700" as const, letterSpacing: 2 },
  track: { flex: 1, height: 4, borderRadius: 2, overflow: "hidden" },
  fill: { height: "100%", borderRadius: 2 },
  value: { width: 48, fontSize: 11, fontWeight: "700" as const, textAlign: "right" },
});

export default function RecapScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user, shadowSelf, achievements, questChains, getShadowPhase, loading, loadError, refresh } = useApp();
  const userId = useGameUserId();

  const recapQ = useQuery({ queryKey: weeklyRecapKey(userId), queryFn: () => fetchWeeklyRecap(api), enabled: !!userId });
  const verdictQ = useQuery({
    queryKey: weeklyDebriefKey(userId),
    queryFn: () => fetchWeeklyDebrief(api),
    enabled: !!userId,
    staleTime: 5 * 60_000,
  });
  const [refreshing, setRefreshing] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([recapQ.refetch(), verdictQ.refetch()]);
    } finally {
      setRefreshing(false);
    }
  };

  if (!user) {
    return (
      <ScreenStatus
        failed={!loading && !!loadError}
        message="The System is out of reach. Check your connection."
        onRetry={() => void refresh()}
      />
    );
  }

  const currentRecap = recapQ.data;
  if (!currentRecap) {
    return (
      <ScreenStatus
        failed={recapQ.isError}
        message="The weekly record is out of reach. Check your connection."
        onRetry={() => void recapQ.refetch()}
      />
    );
  }
  const aiVerdict = verdictQ.data?.debrief ?? "";
  const maxDelta = Math.max(...DOMAINS.map(d => currentRecap.domainDeltas[d]), 0.1);
  const peakDomain = currentRecap.peakDomain;
  const unlockedAchievements = achievements.filter(a => a.unlockedAt !== null);
  const weekDate = new Date(currentRecap.weekStart + "T12:00:00").toLocaleDateString(undefined, {
    month: "short", day: "numeric",
  });
  const shadowPhase = getShadowPhase();
  const shadowPhaseColors = {
    DORMANT: colors.mutedForeground, AWAKENED: "#C4873A", HUNTING: "#E05555", DOMINANT: "#9B0000",
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: topPad + 16, paddingBottom: insets.bottom + 80 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
        }
      >
        {/* Header */}
        <View style={styles.headerRow}>
          <View>
            <Text style={[styles.title, { color: colors.foreground }]}>WEEKLY RECAP</Text>
            <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
              WEEK OF {weekDate.toUpperCase()}
            </Text>
          </View>
          <TouchableOpacity onPress={onRefresh} activeOpacity={0.6} style={[styles.refreshBtn, { borderColor: colors.border }]}>
            <Feather name="refresh-cw" size={13} color={colors.mutedForeground} />
          </TouchableOpacity>
        </View>

        {/* Summary strip */}
        <View style={[styles.summaryStrip, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.summaryItem}>
            <Text style={[styles.summaryVal, { color: colors.foreground, fontFamily: "SpaceMono" }]}>
              {currentRecap.logsCount}
            </Text>
            <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>LOGS</Text>
          </View>
          <View style={[styles.summaryDiv, { backgroundColor: colors.border }]} />
          <View style={styles.summaryItem}>
            <Text style={[styles.summaryVal, { color: "#4B8B6F", fontFamily: "SpaceMono" }]}>
              {currentRecap.questsCompleted}
            </Text>
            <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>QUESTS DONE</Text>
          </View>
          <View style={[styles.summaryDiv, { backgroundColor: colors.border }]} />
          <View style={styles.summaryItem}>
            <Text style={[styles.summaryVal, { color: colors.destructive, fontFamily: "SpaceMono" }]}>
              {currentRecap.questsFailed}
            </Text>
            <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>FAILED</Text>
          </View>
          <View style={[styles.summaryDiv, { backgroundColor: colors.border }]} />
          <View style={styles.summaryItem}>
            <Text style={[styles.summaryVal, { color: colors.mutedForeground, fontFamily: "SpaceMono" }]}>
              {currentRecap.questsRefused}
            </Text>
            <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>REFUSED</Text>
          </View>
        </View>

        {/* Domain gains */}
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.cardHeader}>
            <Text style={[styles.cardLabel, { color: colors.mutedForeground }]}>DOMAIN ACTIVITY THIS WEEK</Text>
            {peakDomain && (
              <View style={[styles.peakBadge, { borderColor: DOMAIN_COLORS[peakDomain] + "50" }]}>
                <Text style={[styles.peakText, { color: DOMAIN_COLORS[peakDomain] }]}>
                  PEAK: {peakDomain}
                </Text>
              </View>
            )}
          </View>
          <View style={styles.barsWrap}>
            {DOMAINS.map(d => (
              <DeltaBar key={d} domain={d} delta={currentRecap.domainDeltas[d]} max={maxDelta} />
            ))}
          </View>
          <Text style={[styles.note, { color: colors.mutedForeground }]}>
            Score movement over the current week, as recorded by the System.
          </Text>
        </View>

        {/* Shadow self status */}
        <View style={[
          styles.shadowCard,
          { backgroundColor: colors.card, borderColor: shadowSelf.active ? "#E0555540" : colors.border },
        ]}>
          <View style={styles.shadowHeader}>
            <Text style={[styles.cardLabel, { color: colors.mutedForeground }]}>SHADOW SELF STATUS</Text>
            <Text style={[styles.phaseTag, { color: shadowPhaseColors[shadowPhase] }]}>
              {shadowPhase}
            </Text>
          </View>
          {shadowSelf.active ? (
            <>
              <Text style={[styles.shadowGap, {
                color: shadowSelf.gap > 0 ? colors.destructive : "#4B8B6F",
                fontFamily: "SpaceMono",
              }]}>
                {shadowSelf.gap > 0 ? `+${shadowSelf.gap.toFixed(1)} PTS AHEAD` : `${Math.abs(shadowSelf.gap).toFixed(1)} PTS BEHIND`}
              </Text>
              <Text style={[styles.shadowDesc, { color: colors.mutedForeground }]}>
                {shadowPhase === "DOMINANT"
                  ? "The Shadow has established dominance. Extreme countermeasures required."
                  : shadowPhase === "HUNTING"
                  ? "It is closing in. Two weeks of consistent logging closes this gap."
                  : shadowPhase === "AWAKENED"
                  ? "Shadow Self is active. It gains daily. Your consistency determines the outcome."
                  : "Shadow dormant. Activate via confrontation to begin the trial."}
              </Text>
            </>
          ) : (
            <Text style={[styles.shadowDesc, { color: colors.mutedForeground }]}>
              Shadow Self not activated. When active, it will grow daily at a preset rate.
            </Text>
          )}
        </View>

        {/* Quest chains */}
        {questChains.length > 0 && (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.cardLabel, { color: colors.mutedForeground }]}>ARC OPERATIONS THIS WEEK</Text>
            <View style={styles.chainRows}>
              {questChains.slice(-4).map(chain => {
                const domColor = DOMAIN_COLORS[chain.domain];
                const progress = chain.totalSteps > 0 ? (Math.min(chain.totalSteps, chain.currentStep) / chain.totalSteps) * 100 : 0;
                return (
                  <View key={chain.id} style={styles.chainRow}>
                    <View style={styles.chainLeft}>
                      <Text style={[styles.chainIcon, { color: domColor }]}>{DOMAIN_ICONS[chain.domain]}</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.chainName, { color: colors.foreground }]}>{chain.name}</Text>
                        <View style={[styles.miniTrack, { backgroundColor: colors.muted }]}>
                          <View style={[styles.miniFill, {
                            width: `${progress}%` as `${number}%`,
                            backgroundColor: chain.status === "complete" ? domColor : domColor + "70",
                          }]} />
                        </View>
                      </View>
                    </View>
                    <Text style={[styles.chainStatus, {
                      color: chain.status === "complete" ? domColor : colors.mutedForeground,
                    }]}>
                      {chain.status === "complete" ? "DONE" : `${chain.currentStep}/${chain.totalSteps}`}
                    </Text>
                  </View>
                );
              })}
            </View>
          </View>
        )}

        {/* Forbidden logs badge */}
        {currentRecap.forbiddenLogs > 0 && (
          <View style={[styles.forbiddenBadge, { borderColor: "#9B000050", backgroundColor: "#9B000008" }]}>
            <Feather name="alert-triangle" size={11} color="#9B0000" />
            <Text style={[styles.forbiddenText, { color: "#9B0000" }]}>
              {currentRecap.forbiddenLogs} FORBIDDEN {currentRecap.forbiddenLogs === 1 ? "LOG" : "LOGS"} TRANSMITTED THIS WEEK
            </Text>
          </View>
        )}

        {/* Achievements unlocked this week */}
        {currentRecap.achievementsUnlocked > 0 && (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: "#C4873A30" }]}>
            <Text style={[styles.cardLabel, { color: "#C4873A" }]}>
              {currentRecap.achievementsUnlocked} ACHIEVEMENT{currentRecap.achievementsUnlocked !== 1 ? "S" : ""} UNLOCKED THIS WEEK
            </Text>
            <View style={styles.achList}>
              {unlockedAchievements
                .filter(a => {
                  if (!a.unlockedAt) return false;
                  return Date.now() - new Date(a.unlockedAt).getTime() < 7 * 24 * 60 * 60 * 1000;
                })
                .map(a => {
                  const def = ACHIEVEMENT_DEFS[a.id];
                  return (
                    <View key={a.id} style={[styles.achRow, { borderColor: "#C4873A20" }]}>
                      <Feather name={def.icon as any} size={12} color="#C4873A" />
                      <Text style={[styles.achTitle, { color: colors.foreground }]}>{def.title}</Text>
                    </View>
                  );
                })}
            </View>
          </View>
        )}

        {/* All-time achievements */}
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <TouchableOpacity
            onPress={() => setExpanded(p => ({ ...p, achievements: !p.achievements }))}
            style={styles.expandHeader}
            activeOpacity={0.7}
          >
            <Text style={[styles.cardLabel, { color: colors.mutedForeground }]}>
              ACHIEVEMENTS — {unlockedAchievements.length}/{achievements.length} UNLOCKED
            </Text>
            <Feather
              name={expanded.achievements ? "chevron-up" : "chevron-down"}
              size={13} color={colors.mutedForeground}
            />
          </TouchableOpacity>

          {expanded.achievements && (
            <View style={styles.achGrid}>
              {achievements.map(a => {
                const def = ACHIEVEMENT_DEFS[a.id];
                const done = a.unlockedAt !== null;
                return (
                  <View
                    key={a.id}
                    style={[
                      styles.achTile,
                      {
                        borderColor: done ? "#C4873A50" : colors.border,
                        backgroundColor: done ? "#C4873A0A" : "transparent",
                        opacity: done ? 1 : 0.4,
                      },
                    ]}
                  >
                    <Feather name={def.icon as any} size={16} color={done ? "#C4873A" : colors.mutedForeground} />
                    <Text style={[styles.achTileTitle, { color: done ? colors.foreground : colors.mutedForeground }]}
                      numberOfLines={2}
                    >
                      {def.title}
                    </Text>
                  </View>
                );
              })}
            </View>
          )}
        </View>

        {/* AI Weekly Verdict */}
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.cardLabel, { color: colors.mutedForeground }]}>SYSTEM WEEKLY VERDICT</Text>
          {verdictQ.isPending ? (
            <Text style={[styles.loading, { color: colors.mutedForeground }]}>Generating assessment...</Text>
          ) : aiVerdict ? (
            <SystemMessage message={aiVerdict} animate={!refreshing} label="THE SYSTEM" />
          ) : (
            <TouchableOpacity
              onPress={() => void verdictQ.refetch()}
              style={[styles.generateBtn, { borderColor: colors.border }]}
              activeOpacity={0.7}
            >
              <Text style={[styles.generateText, { color: colors.mutedForeground }]}>
                RETRY
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

  headerRow: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start",
  },
  title: { fontSize: 14, fontWeight: "700" as const, letterSpacing: 3 },
  subtitle: { fontSize: 9, letterSpacing: 1.5, marginTop: 3, fontWeight: "500" as const },
  refreshBtn: { borderWidth: 1, padding: 8, borderRadius: 4 },

  summaryStrip: {
    flexDirection: "row", borderWidth: 1, borderRadius: 4, padding: 14, alignItems: "center",
  },
  summaryItem: { flex: 1, alignItems: "center", gap: 4 },
  summaryDiv: { width: 1, height: 28 },
  summaryVal: { fontSize: 22, fontWeight: "700" as const },
  summaryLabel: { fontSize: 7, letterSpacing: 1.5, fontWeight: "700" as const },

  card: { borderWidth: 1, borderRadius: 6, padding: 14, gap: 12 },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  cardLabel: { fontSize: 9, letterSpacing: 3, fontWeight: "700" as const },
  peakBadge: { borderWidth: 1, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 2 },
  peakText: { fontSize: 8, fontWeight: "800" as const, letterSpacing: 2 },
  barsWrap: { gap: 10 },
  note: { fontSize: 9, letterSpacing: 0.5 },

  shadowCard: { borderWidth: 1, borderRadius: 6, padding: 14, gap: 8 },
  shadowHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  phaseTag: { fontSize: 9, fontWeight: "800" as const, letterSpacing: 2 },
  shadowGap: { fontSize: 18, fontWeight: "700" as const },
  shadowDesc: { fontSize: 12, lineHeight: 18 },

  chainRows: { gap: 10 },
  chainRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  chainLeft: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8 },
  chainIcon: { fontSize: 12 },
  chainName: { fontSize: 11, fontWeight: "600" as const, marginBottom: 4 },
  miniTrack: { height: 2, borderRadius: 1, overflow: "hidden" },
  miniFill: { height: "100%", borderRadius: 1 },
  chainStatus: { fontSize: 9, fontWeight: "700" as const, letterSpacing: 1.5 },

  forbiddenBadge: {
    flexDirection: "row", alignItems: "center", gap: 8,
    borderWidth: 1, borderRadius: 4, padding: 12,
  },
  forbiddenText: { fontSize: 9, fontWeight: "800" as const, letterSpacing: 2, flex: 1 },

  expandHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  achList: { gap: 8 },
  achRow: {
    flexDirection: "row", alignItems: "center", gap: 10,
    borderWidth: 1, borderRadius: 4, paddingHorizontal: 10, paddingVertical: 8,
  },
  achTitle: { fontSize: 11, fontWeight: "600" as const, flex: 1 },
  achGrid: {
    flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4,
  },
  achTile: {
    width: "47%", borderWidth: 1, borderRadius: 4,
    padding: 10, gap: 6, alignItems: "center",
  },
  achTileTitle: {
    fontSize: 9, fontWeight: "700" as const, letterSpacing: 1,
    textAlign: "center", lineHeight: 13,
  },

  loading: { fontSize: 12, fontStyle: "italic" },
  generateBtn: { borderWidth: 1, borderRadius: 4, padding: 14, alignItems: "center" },
  generateText: { fontSize: 10, letterSpacing: 2, fontWeight: "600" as const },
});
