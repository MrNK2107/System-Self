import React, { useCallback, useState } from "react";
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
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";
import { useAuth } from "@/context/AuthContext";
import { ALL_DOMAINS, DOMAIN_COLORS } from "@/constants/domains";
import { DomainBar } from "@/components/DomainBar";
import { RankBadge } from "@/components/RankBadge";
import { SystemMessage } from "@/components/SystemMessage";
import { LogModal } from "@/components/LogModal";
import { useQuery } from "@tanstack/react-query";
import { useComebackQuery, useGameStateQuery, useGameUserId } from "@/hooks/useGameState";
import { seasonChipLine } from "@/lib/game/life";
import { api } from "@/lib/api/client";
import { briefingKey } from "@/lib/game/keys";
import { fallbackMessage, msUntilLocalMidnight, tryFetchMessage } from "@/lib/game/messages";
import { NightlyDebriefModal } from "@/components/NightlyDebriefModal";
import { useNightlyDebrief } from "@/hooks/useNightlyDebrief";
import { ShadowConfrontationModal } from "@/components/ShadowConfrontationModal";
import { RefuseSheet } from "@/components/RefuseSheet";
import { FloorQuestCard } from "@/components/FloorQuestCard";
import { ComebackCard } from "@/components/ComebackCard";
import { shadowTallyLine } from "@/lib/game/adherence";
import { missedSlotLine, missedSlotQuest, slotStateStale } from "@/lib/game/slots";
import { refuseFailureLine } from "@/lib/game/guards";
import type { Quest, RefuseOutcome } from "@/context/AppContext";

function localDateString(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function ShadowAlertBanner({ onConfront }: { onConfront: () => void }) {
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
    const user = domainScores.find(s => s.domain === d)?.score ?? 0;
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
            const user = domainScores.find(s => s.domain === d)?.score ?? 0;
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
      <TouchableOpacity
        style={[shadowStyles.confrontBtn, { borderColor: isLosing ? "#E0555540" : "#4B8B6F40" }]}
        onPress={onConfront}
        activeOpacity={0.7}
      >
        <Feather name="eye" size={10} color={isLosing ? "#E05555" : "#4B8B6F"} />
        <Text style={[shadowStyles.confrontText, { color: isLosing ? "#E05555" : "#4B8B6F" }]}>
          CONFRONT SHADOW
        </Text>
        <Feather name="chevron-right" size={10} color={isLosing ? "#E05555" : "#4B8B6F"} />
      </TouchableOpacity>
    </View>
  );
}

const shadowStyles = StyleSheet.create({
  confrontBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    borderWidth: 1,
    borderRadius: 2,
    paddingVertical: 8,
    marginTop: 4,
  },
  confrontText: {
    fontSize: 9,
    fontWeight: "700" as const,
    letterSpacing: 3,
  },
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
  const userId = useGameUserId();
  const { user, domainScores, quests, shadowSelf, trajectory, loading, loadError, refresh, refuseQuest, questsUpdatedAt } = useApp();
  const { pendingDebrief, acknowledgeDebrief, debriefText } = useNightlyDebrief();
  const comeback = useComebackQuery().data?.active ?? null;
  const season = useGameStateQuery().data?.profile.season ?? null;

  const [logVisible, setLogVisible] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [confrontVisible, setConfrontVisible] = useState(false);
  const [refusing, setRefusing] = useState<Quest | null>(null);
  const [refuseBusy, setRefuseBusy] = useState(false);
  const [floorOffer, setFloorOffer] = useState<(RefuseOutcome & { questId: string }) | null>(null);
  const [refuseError, setRefuseError] = useState<string | null>(null);
  // The banner re-checks the clock once a minute so a slot that lapses while the app is open shows up. Times and
  // dates are read in the account timezone (as the server judges slots), else the device's.
  // When the local date changes, the cached slot states are stale: refetch instead of trusting them.
  const accountTz = useAuth().user?.timezone;
  const [clock, setClock] = useState(() => new Date());
  const computedAt = new Date(questsUpdatedAt || clock.getTime());
  const dateChanged = slotStateStale(clock, computedAt, accountTz);
  React.useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  React.useEffect(() => {
    if (dateChanged) void refresh();
  }, [dateChanged, refresh]);

  const rank = user?.rank ?? "E";
  const activeQuests = quests.filter(q => q.status === "active");
  const completedToday = quests.filter(q => q.status === "complete").length;
  const missed = missedSlotQuest(quests, clock, computedAt, accountTz);

  const confirmRefuse = async (reason: string) => {
    if (!refusing || refuseBusy) return;
    setRefuseBusy(true);
    setRefuseError(null);
    try {
      const questId = refusing.id;
      const r = await refuseQuest(questId, reason);
      if (r.ok) setFloorOffer(r.value.floor ? { ...r.value, questId } : null);
      else setRefuseError(refuseFailureLine(r));
      setRefusing(null);
    } finally {
      setRefuseBusy(false);
    }
  };

  // One briefing call per local day: the server caches it per day too, so a refresh shows the same text.
  const briefingQ = useQuery({
    queryKey: briefingKey(userId, localDateString()),
    queryFn: async () => {
      const text = await tryFetchMessage(api, "morning_briefing");
      if (text === null) throw new Error("briefing unavailable");
      return text;
    },
    enabled: !!user,
    staleTime: msUntilLocalMidnight(),
    retry: false,
  });
  const briefing = briefingQ.data ?? (briefingQ.isError ? fallbackMessage("morning_briefing") : "");

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      setRefreshing(false);
    }
  }, [refresh]);

  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);

  if (!user) {
    return (
      <View style={[styles.container, styles.center, { backgroundColor: colors.background }]}>
        {loading || !loadError ? (
          <ActivityIndicator color={colors.primary} />
        ) : (
          <>
            <Text style={[styles.stateLine, { color: colors.mutedForeground }]}>
              The System is out of reach. Check your connection.
            </Text>
            <TouchableOpacity onPress={() => void refresh()} accessibilityRole="button" style={styles.retryBtn}>
              <Text style={[styles.retryText, { color: colors.primary }]}>RETRY</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {pendingDebrief && (
        <NightlyDebriefModal
          visible={!!pendingDebrief}
          debrief={pendingDebrief}
          username={user.username}
          dayNumber={user.dayNumber}
          onAcknowledge={acknowledgeDebrief}
        />
      )}
      <ShadowConfrontationModal
        visible={confrontVisible}
        onClose={() => setConfrontVisible(false)}
      />
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
            <TouchableOpacity
              onPress={() => router.push("/settings")}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityRole="button"
              accessibilityLabel="Settings"
            >
              <Feather name="settings" size={20} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Lock the Slot: the chosen window has passed and the quest is still open */}
        {missed && (
          <View style={[styles.slotBanner, { borderColor: colors.destructive + "60", backgroundColor: colors.card }]}>
            <Text style={[styles.sectionLabel, { color: colors.destructive }]}>SLOT MISSED</Text>
            <Text style={[styles.slotLine, { color: colors.foreground }]}>
              {missedSlotLine(missed.slotStart!, clock, accountTz)}
            </Text>
            <Text style={[styles.questTitle, { color: colors.mutedForeground }]} numberOfLines={1}>{missed.title}</Text>
            <View style={styles.slotButtons}>
              <TouchableOpacity
                style={[styles.slotBtn, { borderColor: colors.border }]}
                onPress={() => setRefusing(missed)}
                accessibilityRole="button"
                accessibilityLabel="Not today"
                activeOpacity={0.7}
              >
                <Text style={[styles.slotBtnText, { color: colors.mutedForeground }]}>NOT TODAY</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.slotBtn, { borderColor: colors.primary + "80", backgroundColor: colors.primary + "18" }]}
                onPress={() => router.push("/dungeon/briefing")}
                accessibilityRole="button"
                accessibilityLabel="Go now"
                activeOpacity={0.7}
              >
                <Text style={[styles.slotBtnText, { color: colors.primary }]}>GO NOW</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
        {refuseError && (
          <Text style={[styles.refuseError, { color: colors.destructive }]} accessibilityLiveRegion="polite">{refuseError}</Text>
        )}

        {season && (
          <View
            style={[styles.seasonChip, { borderColor: colors.primary + "60", backgroundColor: colors.card }]}
            accessibilityLabel={`Season: ${seasonChipLine(season).title} ${seasonChipLine(season).meta}`}
          >
            <Text style={[styles.seasonLine, { color: colors.foreground }]}>{seasonChipLine(season).title}</Text>
            <Text style={[styles.seasonMeta, { color: colors.mutedForeground }]}>{seasonChipLine(season).meta}</Text>
          </View>
        )}
        {comeback && <ComebackCard gapDays={comeback.gapDays} checklist={comeback.checklist} />}

        {floorOffer?.floor && (
          <FloorQuestCard
            routine={floorOffer.floor}
            shadowLine={floorOffer.shadowTook ? shadowTallyLine(floorOffer.shadowTook.questTitle) : null}
            onStart={() => {
              const { floor, questId } = floorOffer;
              setFloorOffer(null);
              router.push({ pathname: "/floor/[routineId]", params: { routineId: floor!.id, refusedQuestId: questId } });
            }}
            onDismiss={() => setFloorOffer(null)}
          />
        )}

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
          {briefingQ.isPending && !briefing ? (
            <ActivityIndicator color={colors.primary} size="small" />
          ) : briefing ? (
            <SystemMessage message={briefing} animate={!refreshing} label="THE SYSTEM" />
          ) : (
            <Text style={[styles.placeholder, { color: colors.mutedForeground }]}>Loading transmission...</Text>
          )}
        </View>

        {/* Nightly debrief text, once the debrief has opened */}
        {debriefText ? (
          <View style={[styles.intelCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.intelHeader}>
              <Text style={[styles.intelLabel, { color: colors.mutedForeground }]}>NIGHTLY DEBRIEF</Text>
            </View>
            <SystemMessage message={debriefText} animate={!refreshing} label="THE SYSTEM" />
          </View>
        ) : null}

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
        {shadowSelf.active && <ShadowAlertBanner onConfront={() => setConfrontVisible(true)} />}
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
      <RefuseSheet
        visible={refusing !== null}
        questTitle={refusing?.title ?? ""}
        busy={refuseBusy}
        onCancel={() => setRefusing(null)}
        onConfirm={(reason) => void confirmRefuse(reason)}
      />
    </View>
  );
}

import { Platform } from "react-native";

const styles = StyleSheet.create({
  seasonChip: { borderWidth: 1, borderRadius: 4, padding: 12, gap: 4 },
  seasonLine: { fontSize: 12, fontWeight: "700" as const, letterSpacing: 0.5 },
  seasonMeta: { fontSize: 11 },
  container: { flex: 1 },
  center: { alignItems: "center", justifyContent: "center", gap: 16, paddingHorizontal: 32 },
  stateLine: { fontSize: 13, lineHeight: 20, textAlign: "center" },
  retryBtn: { paddingVertical: 8, paddingHorizontal: 16 },
  retryText: { fontSize: 11, fontWeight: "700" as const, letterSpacing: 3 },
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
  intelCard: {
    padding: 16,
    borderRadius: 4,
    borderWidth: 1,
    gap: 12,
    minHeight: 92,
    justifyContent: "center",
  },
  intelHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  intelLabel: {
    fontSize: 9,
    letterSpacing: 3,
    fontWeight: "600" as const,
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
  slotBanner: { borderWidth: 1, borderRadius: 4, padding: 16, gap: 8 },
  slotLine: { fontSize: 15, fontWeight: "700" as const, letterSpacing: 0.5 },
  refuseError: { fontSize: 11, lineHeight: 17, letterSpacing: 0.3 },
  slotButtons: { flexDirection: "row", gap: 8, marginTop: 4 },
  slotBtn: { flex: 1, borderWidth: 1, borderRadius: 2, paddingVertical: 12, alignItems: "center" },
  slotBtnText: { fontSize: 11, fontWeight: "700" as const, letterSpacing: 2 },
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
