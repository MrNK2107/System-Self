import React, { useRef, useEffect } from "react";
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
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useApp, type Quest } from "@/context/AppContext";
import { QuestCard } from "@/components/QuestCard";
import { useQuestScheduler } from "@/hooks/useQuestScheduler";

const DOMAIN_COLORS = {
  BODY: "#E05555",
  MIND: "#3A7BD5",
  WEALTH: "#4B8B6F",
  DISCIPLINE: "#C4873A",
};

function GeneratingState() {
  const colors = useColors();
  const pulseAnim = useRef(new Animated.Value(0.3)).current;
  const dotAnims = useRef([0, 1, 2].map(() => new Animated.Value(0))).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 0.8, duration: 1200, useNativeDriver: false }),
        Animated.timing(pulseAnim, { toValue: 0.3, duration: 1200, useNativeDriver: false }),
      ])
    ).start();

    dotAnims.forEach((anim, i) => {
      setTimeout(() => {
        Animated.loop(
          Animated.sequence([
            Animated.timing(anim, { toValue: 1, duration: 500, useNativeDriver: false }),
            Animated.timing(anim, { toValue: 0.2, duration: 500, useNativeDriver: false }),
          ])
        ).start();
      }, i * 180);
    });
  }, []);

  return (
    <View style={genStyles.container}>
      <View style={[genStyles.card, { borderColor: colors.border, backgroundColor: colors.card }]}>
        <View style={genStyles.top}>
          <Animated.View style={[genStyles.statusDot, { opacity: pulseAnim, backgroundColor: colors.primary }]} />
          <Text style={[genStyles.label, { color: colors.primary }]}>GENERATING TRANSMISSION</Text>
        </View>
        <Text style={[genStyles.sub, { color: colors.mutedForeground }]}>
          THE SYSTEM is calibrating your operations based on current rank, shadow gap, and domain weakness.
        </Text>
        <View style={genStyles.dotRow}>
          {dotAnims.map((anim, i) => (
            <Animated.View
              key={i}
              style={[genStyles.dot, { backgroundColor: colors.primary, opacity: anim }]}
            />
          ))}
        </View>
      </View>
    </View>
  );
}

const genStyles = StyleSheet.create({
  container: { paddingVertical: 24 },
  card: {
    borderWidth: 1,
    borderRadius: 6,
    padding: 20,
    gap: 12,
  },
  top: { flexDirection: "row", alignItems: "center", gap: 8 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  label: { fontSize: 10, fontWeight: "700" as const, letterSpacing: 3 },
  sub: { fontSize: 12, lineHeight: 20 },
  dotRow: { flexDirection: "row", gap: 6, marginTop: 4 },
  dot: { width: 5, height: 5, borderRadius: 2.5 },
});

export default function QuestsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { quests, completeQuest, refuseQuest, shadowSelf, domainScores, getWeakestDomain } = useApp();
  const { generating, lastGenRecord, triggerGeneration } = useQuestScheduler();

  const [refreshing, setRefreshing] = React.useState(false);
  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);

  const onRefresh = async () => {
    setRefreshing(true);
    await triggerGeneration();
    setRefreshing(false);
  };

  // Partition quests
  const activeDailies = quests.filter(q => q.type === "daily" && q.status === "active");
  const activeWeeklies = quests.filter(q => q.type === "weekly" && q.status === "active");
  const activeArcs = quests.filter(q => q.type === "arc" && q.status === "active");
  const completedQuests = quests.filter(q => q.status === "complete");
  const failedQuests = quests.filter(q => q.status === "failed" || q.status === "refused");

  const completedCount = completedQuests.length;
  const totalActive = activeDailies.length + activeWeeklies.length + activeArcs.length;
  const rate = (completedCount + totalActive) > 0
    ? Math.round((completedCount / (completedCount + totalActive)) * 100)
    : 0;

  // Shadow pressure
  const shadowGap = shadowSelf.gap;
  const shadowPressure = shadowGap > 20 ? "critical" : shadowGap > 10 ? "elevated" : shadowGap > 0 ? "active" : "none";
  const weakest = getWeakestDomain();

  // Next gen time: 4am tomorrow
  const nextGen = new Date();
  nextGen.setDate(nextGen.getDate() + 1);
  nextGen.setHours(4, 0, 0, 0);
  const nextGenStr = nextGen.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

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
            <Text style={[styles.title, { color: colors.foreground }]}>QUEST BOARD</Text>
            <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
              {lastGenRecord
                ? `ISSUED TODAY AT ${lastGenRecord.time}`
                : "AWAITING TRANSMISSION"}
            </Text>
          </View>
          <View style={styles.headerRight}>
            <View style={[styles.rateBadge, { borderColor: colors.border }]}>
              <Text style={[styles.rateLabel, { color: colors.mutedForeground }]}>DONE</Text>
              <Text style={[
                styles.rateValue,
                { color: rate >= 60 ? "#4B8B6F" : rate >= 30 ? "#C4873A" : colors.destructive },
              ]}>
                {rate}%
              </Text>
            </View>
          </View>
        </View>

        {/* Calibration banner */}
        {lastGenRecord && (
          <View style={[styles.calibrationBanner, { borderColor: colors.border, backgroundColor: colors.card }]}>
            <View style={styles.calibRow}>
              <View style={styles.calibItem}>
                <Text style={[styles.calibLabel, { color: colors.mutedForeground }]}>RANK</Text>
                <Text style={[styles.calibValue, { color: colors.foreground }]}>{lastGenRecord.rank}</Text>
              </View>
              <View style={[styles.calibDiv, { backgroundColor: colors.border }]} />
              <View style={styles.calibItem}>
                <Text style={[styles.calibLabel, { color: colors.mutedForeground }]}>WEAKEST</Text>
                <Text style={[styles.calibValue, { color: DOMAIN_COLORS[weakest] }]}>{weakest}</Text>
              </View>
              <View style={[styles.calibDiv, { backgroundColor: colors.border }]} />
              <View style={styles.calibItem}>
                <Text style={[styles.calibLabel, { color: colors.mutedForeground }]}>SHADOW GAP</Text>
                <Text style={[
                  styles.calibValue,
                  { color: lastGenRecord.shadowGap > 0 ? colors.destructive : "#4B8B6F" },
                ]}>
                  {lastGenRecord.shadowGap > 0 ? `+${lastGenRecord.shadowGap.toFixed(1)}` : lastGenRecord.shadowGap.toFixed(1)}
                </Text>
              </View>
              <View style={[styles.calibDiv, { backgroundColor: colors.border }]} />
              <View style={styles.calibItem}>
                <Text style={[styles.calibLabel, { color: colors.mutedForeground }]}>RESETS</Text>
                <Text style={[styles.calibValue, { color: colors.mutedForeground }]}>{nextGenStr}</Text>
              </View>
            </View>
          </View>
        )}

        {/* Shadow pressure badge */}
        {shadowPressure !== "none" && (
          <View style={[styles.pressureBadge, {
            borderColor: shadowPressure === "critical" ? "#E0555550" : "#E0555530",
            backgroundColor: shadowPressure === "critical" ? "#E0555510" : "#E0555508",
          }]}>
            <Feather name="alert-triangle" size={10} color="#E05555" />
            <Text style={styles.pressureText}>
              {shadowPressure === "critical"
                ? `CRITICAL — SHADOW LEADS BY ${shadowGap.toFixed(1)} PTS — OPERATIONS ESCALATED`
                : shadowPressure === "elevated"
                ? `SHADOW +${shadowGap.toFixed(1)} — DISCIPLINE BIAS APPLIED TO BOARD`
                : `SHADOW ACTIVE — ${shadowGap.toFixed(1)} PTS AHEAD`}
            </Text>
          </View>
        )}

        {/* Generating state */}
        {generating && <GeneratingState />}

        {/* Quest sections */}
        {!generating && (
          <>
            {/* Daily */}
            {activeDailies.length > 0 && (
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>DAILY</Text>
                  <Text style={[styles.sectionMeta, { color: colors.mutedForeground }]}>
                    {activeDailies.length} active
                  </Text>
                </View>
                {activeDailies.map(q => (
                  <QuestCard key={q.id} quest={q} onComplete={completeQuest} onRefuse={refuseQuest} />
                ))}
              </View>
            )}

            {/* Weekly */}
            {activeWeeklies.length > 0 && (
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>WEEKLY</Text>
                  <Text style={[styles.sectionMeta, { color: colors.mutedForeground }]}>
                    {activeWeeklies.length} active
                  </Text>
                </View>
                {activeWeeklies.map(q => (
                  <QuestCard key={q.id} quest={q} onComplete={completeQuest} onRefuse={refuseQuest} />
                ))}
              </View>
            )}

            {/* Arc */}
            {activeArcs.length > 0 && (
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Text style={[styles.sectionLabel, { color: "#C4873A" }]}>ARC OPERATION</Text>
                  <View style={[styles.arcBadge, { borderColor: "#C4873A40" }]}>
                    <Text style={[styles.arcBadgeText, { color: "#C4873A" }]}>MULTI-WEEK</Text>
                  </View>
                </View>
                {activeArcs.map(q => (
                  <QuestCard key={q.id} quest={q} onComplete={completeQuest} />
                ))}
              </View>
            )}

            {/* Completed */}
            {completedQuests.length > 0 && (
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>COMPLETED</Text>
                  <Text style={[styles.sectionMeta, { color: "#4B8B6F" }]}>+{completedQuests.length}</Text>
                </View>
                {completedQuests.map(q => (
                  <QuestCard key={q.id} quest={q} onComplete={completeQuest} />
                ))}
              </View>
            )}

            {/* Failed/Refused */}
            {failedQuests.length > 0 && (
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>EXPIRED / REFUSED</Text>
                  <Text style={[styles.sectionMeta, { color: colors.destructive }]}>
                    −{failedQuests.length}
                  </Text>
                </View>
                {failedQuests.map(q => (
                  <QuestCard key={q.id} quest={q} onComplete={completeQuest} />
                ))}
              </View>
            )}

            {/* Empty */}
            {totalActive === 0 && completedCount === 0 && !generating && (
              <View style={[styles.emptyCard, { borderColor: colors.border }]}>
                <Feather name="inbox" size={24} color={colors.mutedForeground} />
                <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Board empty.</Text>
                <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                  Pull down to force generation. THE SYSTEM will assign new operations.
                </Text>
              </View>
            )}
          </>
        )}

        {/* Manual refresh hint */}
        {!generating && totalActive > 0 && (
          <TouchableOpacity onPress={onRefresh} activeOpacity={0.6} style={styles.refreshHint}>
            <Text style={[styles.refreshHintText, { color: colors.mutedForeground }]}>
              ↓ Pull to force regeneration
            </Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { paddingHorizontal: 20, gap: 12 },

  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  title: {
    fontSize: 14,
    fontWeight: "700" as const,
    letterSpacing: 3,
  },
  subtitle: {
    fontSize: 9,
    letterSpacing: 1.5,
    marginTop: 3,
    fontWeight: "500" as const,
  },
  headerRight: {},
  rateBadge: {
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 2,
    alignItems: "center",
  },
  rateLabel: {
    fontSize: 7,
    letterSpacing: 2,
    fontWeight: "700" as const,
  },
  rateValue: {
    fontSize: 16,
    fontWeight: "800" as const,
  },

  calibrationBanner: {
    borderWidth: 1,
    borderRadius: 4,
    padding: 12,
  },
  calibRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  calibItem: {
    flex: 1,
    alignItems: "center",
    gap: 3,
  },
  calibDiv: {
    width: StyleSheet.hairlineWidth,
    height: 24,
  },
  calibLabel: {
    fontSize: 7,
    letterSpacing: 1.5,
    fontWeight: "600" as const,
  },
  calibValue: {
    fontSize: 11,
    fontWeight: "700" as const,
    letterSpacing: 0.5,
  },

  pressureBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    borderWidth: 1,
    borderRadius: 3,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  pressureText: {
    flex: 1,
    fontSize: 9,
    fontWeight: "700" as const,
    letterSpacing: 1.5,
    color: "#E05555",
  },

  section: { gap: 8 },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 2,
  },
  sectionLabel: {
    fontSize: 9,
    letterSpacing: 3,
    fontWeight: "700" as const,
  },
  sectionMeta: {
    fontSize: 9,
    letterSpacing: 1,
    fontWeight: "600" as const,
  },

  arcBadge: {
    borderWidth: 1,
    borderRadius: 2,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  arcBadgeText: {
    fontSize: 7,
    letterSpacing: 2,
    fontWeight: "700" as const,
  },

  emptyCard: {
    borderWidth: 1,
    borderRadius: 6,
    alignItems: "center",
    paddingVertical: 48,
    paddingHorizontal: 24,
    gap: 10,
    marginTop: 8,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: "600" as const,
    marginTop: 4,
  },
  emptyText: {
    fontSize: 12,
    textAlign: "center",
    lineHeight: 19,
  },

  refreshHint: {
    alignItems: "center",
    paddingVertical: 8,
    marginTop: 4,
  },
  refreshHintText: {
    fontSize: 10,
    letterSpacing: 1,
  },
});
