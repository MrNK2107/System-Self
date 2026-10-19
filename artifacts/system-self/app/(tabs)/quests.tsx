import React, { useRef, useEffect, useState } from "react";
import {
  ActivityIndicator,
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
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useApp, type ChainTemplate, type Domain, type Quest } from "@/context/AppContext";
import { useAuth } from "@/context/AuthContext";
import { hasApiCode, isStaleFailure, isoWeekKey, mutationFailureLine, refuseFailureLine } from "@/lib/game/guards";
import { RefuseSheet, REFUSAL_RULE } from "@/components/RefuseSheet";
import { QuestCard } from "@/components/QuestCard";
import { ProLock } from "@/components/ProLock";
import { useMyClanQuery } from "@/hooks/useClan";
import { isProRequired } from "@/lib/api/pro";
import { describeChallengeError } from "@/lib/challenges/challenges";
import { SlotPicker } from "@/components/SlotPicker";
import { FloorQuestCard } from "@/components/FloorQuestCard";
import { useQuietHours } from "@/hooks/useDungeon";
import { localWeekday, quietChips, quietHint } from "@/lib/game/dungeon";
import { shadowTallyLine } from "@/lib/game/adherence";
import type { RefuseOutcome } from "@/context/AppContext";
import { QuestChainCard, QuestChainCatalogCard } from "@/components/QuestChainCard";
import { useQuestScheduler } from "@/hooks/useQuestScheduler";
import { DOMAIN_COLORS } from "@/constants/domains";

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
  card: { borderWidth: 1, borderRadius: 6, padding: 20, gap: 12 },
  top: { flexDirection: "row", alignItems: "center", gap: 8 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  label: { fontSize: 10, fontWeight: "700" as const, letterSpacing: 3 },
  sub: { fontSize: 12, lineHeight: 20 },
  dotRow: { flexDirection: "row", gap: 6, marginTop: 4 },
  dot: { width: 5, height: 5, borderRadius: 2.5 },
});

// ---- Rank-up prep quests ---------------------------------------------------

const RANK_UP_PREP_QUESTS: Record<string, { title: string; description: string; domain: Domain }[]> = {
  D: [
    { title: "LOG 7 CONSECUTIVE DAYS", description: "Log at least one domain per day for 7 days without missing. This establishes the baseline for D-rank.", domain: "DISCIPLINE" },
    { title: "AWARENESS AUDIT", description: "Log one detailed entry across all 5 domains this week. The system requires a complete assessment.", domain: "MIND" },
  ],
  C: [
    { title: "3-DAY STREAK IN ALL DOMAINS", description: "Log all 5 domains for 3 days in a row. Consistency is the only qualifier for rank C.", domain: "DISCIPLINE" },
    { title: "PUSH WEAKEST DOMAIN TO 60+", description: "Your weakest domain score must clear 60. Any method counts. The number does not lie.", domain: "BODY" },
  ],
  B: [
    { title: "COMPLETE 3 QUESTS THIS WEEK", description: "Operatives at B rank complete, not attempt. Mark 3 quests done before the week ends.", domain: "DISCIPLINE" },
    { title: "SHADOW GAP UNDER 5 POINTS", description: "Close the distance with your Shadow Self to under 5 composite points.", domain: "DISCIPLINE" },
  ],
  A: [
    { title: "ALL DOMAINS ABOVE 70", description: "No ceiling below 70 in any domain. A-rank operatives do not have weak points.", domain: "MIND" },
    { title: "10-DAY UNBROKEN STREAK", description: "Log at least 2 domains per day for 10 consecutive days. The system recognizes this.", domain: "DISCIPLINE" },
  ],
  S: [
    { title: "DISCIPLINE SOVEREIGN", description: "Push DISCIPLINE past 90. S-rank requires system-level self-command.", domain: "DISCIPLINE" },
    { title: "ALL DOMAINS ABOVE 85", description: "Every domain at 85 or higher. S-rank is total sovereignty, not selective excellence.", domain: "BODY" },
  ],
};

export default function QuestsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ domain?: string }>();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const {
    quests, completeQuest, refuseQuest, setQuestSlot, setQuestShame, shadowSelf, getWeakestDomain,
    questChains, chainTemplates, startQuestChain, user, tierProgress,
    loading, loadError, questsLoadError, refresh, offline,
  } = useApp();
  const { generating, triggerGeneration } = useQuestScheduler();
  // Quiet-hours chips are for the account's weekday (its timezone, as the server records reports), else the device's.
  const accountTz = useAuth().user?.timezone;

  const [refreshing, setRefreshing] = React.useState(false);
  const [showChainCatalog, setShowChainCatalog] = useState(false);
  const [refusing, setRefusing] = useState<Quest | null>(null);
  const [refuseBusy, setRefuseBusy] = useState(false);
  const [slotting, setSlotting] = useState<Quest | null>(null);
  const [slotBusy, setSlotBusy] = useState(false);
  const quiet = useQuietHours(slotting !== null);
  const openBriefing = () => router.push("/dungeon/briefing");
  // The floor routine offered right after a BODY quest was refused (cleared when dismissed or started).
  const [floorOffer, setFloorOffer] = useState<(RefuseOutcome & { questId: string }) | null>(null);
  // The 409 refusal_limit marker belongs to one account and one ISO week.
  const userId = user?.id ?? null;
  const [limitMark, setLimitMark] = useState<{ userId: string | null; week: string } | null>(null);
  const refusalLimit = limitMark !== null && limitMark.userId === userId && limitMark.week === isoWeekKey(new Date());
  // Quests with a request in flight: repeats are ignored and the card's buttons are disabled.
  const inFlight = useRef(new Set<string>());
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(() => new Set());
  const setBusy = (id: string, on: boolean) => {
    if (on) inFlight.current.add(id);
    else inFlight.current.delete(id);
    setBusyIds(new Set(inFlight.current));
  };
  const [startingKey, setStartingKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // PRO Shame Mode: offered on active quests only for clan members; a free account's toggle shows the PRO lock.
  const inClan = !!useMyClanQuery().data?.clan;
  const [shamePro, setShamePro] = useState(false);
  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([refresh(), triggerGeneration()]);
    } finally {
      setRefreshing(false);
    }
  };

  const describeFailure = mutationFailureLine;
  const isStale = isStaleFailure;

  const onComplete = async (id: string) => {
    if (inFlight.current.has(id)) return;
    setBusy(id, true);
    setNotice(null);
    try {
      const r = await completeQuest(id);
      if (!r.ok && !isStale(r)) setNotice(describeFailure(r));
    } finally {
      setBusy(id, false);
    }
  };

  const confirmRefuse = async (reason: string) => {
    if (!refusing || inFlight.current.has(refusing.id)) return;
    const id = refusing.id;
    setBusy(id, true);
    setRefuseBusy(true);
    setNotice(null);
    try {
      const r = await refuseQuest(id, reason);
      if (r.ok) {
        setFloorOffer(r.value.floor ? { ...r.value, questId: id } : null);
      } else {
        // The limit shows as the rule under the list (and disables Refuse); every other failure is a notice line.
        if (r.reason === "error" && hasApiCode(r.error, "refusal_limit")) setLimitMark({ userId, week: isoWeekKey(new Date()) });
        else setNotice(refuseFailureLine(r));
      }
      setRefusing(null);
    } finally {
      setBusy(id, false);
      setRefuseBusy(false);
    }
  };

  const onShame = async (quest: Quest, enabled: boolean) => {
    if (inFlight.current.has(quest.id)) return;
    setBusy(quest.id, true);
    setNotice(null);
    try {
      const r = await setQuestShame(quest.id, enabled);
      if (r.ok || isStale(r)) return;
      if (r.reason === "error" && isProRequired(r.error)) setShamePro(true);
      else if (r.reason === "error") setNotice(describeChallengeError(r.error));
      else setNotice(describeFailure(r));
    } finally {
      setBusy(quest.id, false);
    }
  };

  const saveSlot = async (slot: { slotStart: string; slotEnd: string } | null) => {
    if (!slotting || inFlight.current.has(slotting.id)) return;
    const id = slotting.id;
    setBusy(id, true);
    setSlotBusy(true);
    setNotice(null);
    try {
      const r = await setQuestSlot(id, slot);
      if (!r.ok && !isStale(r)) setNotice(describeFailure(r));
      setSlotting(null);
    } finally {
      setBusy(id, false);
      setSlotBusy(false);
    }
  };

  const domainFilter = (
    params.domain === "BODY" ||
    params.domain === "MIND" ||
    params.domain === "WEALTH" ||
    params.domain === "SOCIAL" ||
    params.domain === "DISCIPLINE"
  ) ? params.domain : null;

  const visibleQuests = domainFilter
    ? quests.filter(q => q.domain === domainFilter)
    : quests;

  // Partition quests
  const activeDailies = visibleQuests.filter(q => q.type === "daily" && q.status === "active");
  const activeWeeklies = visibleQuests.filter(q => q.type === "weekly" && q.status === "active");
  const activeArcs = visibleQuests.filter(q => q.type === "arc" && q.status === "active");
  const completedQuests = visibleQuests.filter(q => q.status === "complete");
  const failedQuests = visibleQuests.filter(q => q.status === "failed" || q.status === "refused");

  const completedCount = completedQuests.length;
  const totalActive = activeDailies.length + activeWeeklies.length + activeArcs.length;
  const rate = (completedCount + totalActive) > 0
    ? Math.round((completedCount / (completedCount + totalActive)) * 100)
    : 0;

  const showGenerating = generating && totalActive === 0;
  const showLoading = loading && quests.length === 0;
  const showError = (!!loadError || !!questsLoadError) && quests.length === 0 && !loading;

  // Shadow pressure
  const shadowGap = shadowSelf.gap;
  const shadowPressure = shadowGap > 20 ? "critical" : shadowGap > 10 ? "elevated" : shadowGap > 0 ? "active" : "none";
  const weakest = getWeakestDomain();

  // Rank-up prep: progress through the current rank band comes from the server (tierProgress).
  const rank = user?.rank ?? "E";
  const nextRank = ({ E: "D", D: "C", C: "B", B: "A", A: "S", S: null } as Record<string, string | null>)[rank];
  const progressToNext = tierProgress;
  const showRankUpPrep = nextRank && progressToNext >= 75;
  const rankUpPrepItems = nextRank ? (RANK_UP_PREP_QUESTS[nextRank] ?? []) : [];

  // Active chains
  const activeChains = questChains.filter(c => c.status === "active");
  const completedChains = questChains.filter(c => c.status === "complete");

  // Next gen time: 4am tomorrow
  const nextGen = new Date();
  nextGen.setDate(nextGen.getDate() + 1);
  nextGen.setHours(4, 0, 0, 0);
  const nextGenStr = nextGen.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  const handleStartChain = async (template: ChainTemplate) => {
    if (startingKey) return;
    if (questChains.some(c => c.templateKey === template.templateKey && c.status === "active")) return;
    setStartingKey(template.templateKey);
    setNotice(null);
    try {
      const r = await startQuestChain(template.templateKey);
      if (r.ok) return;
      // chain_active: another device started it; the refetch that follows shows it as active.
      if (r.reason === "error" && hasApiCode(r.error, "chain_active")) setNotice("Chain already active.");
      else setNotice(describeFailure(r));
    } finally {
      setStartingKey(null);
    }
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
            <Text style={[styles.title, { color: colors.foreground }]}>QUEST BOARD</Text>
            <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
              {totalActive > 0 ? "ISSUED BY THE SYSTEM" : generating ? "TRANSMITTING" : "AWAITING TRANSMISSION"}
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

        {domainFilter && (
          <View style={[styles.filterBar, { borderColor: colors.border, backgroundColor: colors.card }]}>
            <Text style={[styles.filterText, { color: colors.mutedForeground }]}>
              FILTER:{" "}
              <Text style={{ color: DOMAIN_COLORS[domainFilter], fontWeight: "700" }}>
                {domainFilter}
              </Text>
            </Text>
            <TouchableOpacity
              onPress={() => router.replace("/(tabs)/quests")}
              activeOpacity={0.7}
            >
              <Text style={[styles.clearFilterText, { color: colors.primary }]}>CLEAR</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Calibration banner */}
        {totalActive > 0 && (
          <View style={[styles.calibrationBanner, { borderColor: colors.border, backgroundColor: colors.card }]}>
            <View style={styles.calibRow}>
              <View style={styles.calibItem}>
                <Text style={[styles.calibLabel, { color: colors.mutedForeground }]}>RANK</Text>
                <Text style={[styles.calibValue, { color: colors.foreground }]}>{user?.rank ?? "E"}</Text>
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
                  { color: shadowGap > 0 ? colors.destructive : "#4B8B6F" },
                ]}>
                  {shadowGap > 0 ? `+${shadowGap.toFixed(1)}` : shadowGap.toFixed(1)}
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

        {/* Rank-up prep missions */}
        {showRankUpPrep && rankUpPrepItems.length > 0 && (
          <View style={[styles.rankUpSection, { borderColor: "#C4873A40", backgroundColor: "#C4873A06" }]}>
            <View style={styles.rankUpHeader}>
              <Feather name="arrow-up-circle" size={12} color="#C4873A" />
              <Text style={[styles.rankUpLabel, { color: "#C4873A" }]}>
                RANK-UP PREP — PROMOTE TO {nextRank}
              </Text>
              <Text style={[styles.rankUpPct, { color: "#C4873A", fontFamily: "SpaceMono" }]}>
                {Math.round(progressToNext)}%
              </Text>
            </View>
            <Text style={[styles.rankUpDesc, { color: colors.mutedForeground }]}>
              You are near the promotion threshold. Complete these preparations before rank evaluation.
            </Text>
            {rankUpPrepItems.map((item, i) => (
              <View key={i} style={[styles.prepItem, { borderColor: "#C4873A30" }]}>
                <View style={[styles.prepNum, { backgroundColor: "#C4873A20" }]}>
                  <Text style={[styles.prepNumText, { color: "#C4873A" }]}>{i + 1}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.prepTitle, { color: colors.foreground }]}>{item.title}</Text>
                  <Text style={[styles.prepDesc, { color: colors.mutedForeground }]}>{item.description}</Text>
                </View>
                <View style={[styles.prepDomain, { borderColor: (DOMAIN_COLORS[item.domain] ?? "#C4873A") + "50" }]}>
                  <Text style={[styles.prepDomainText, { color: DOMAIN_COLORS[item.domain] ?? "#C4873A" }]}>
                    {item.domain.slice(0, 4)}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        )}

        {notice && <Text style={[styles.notice, { color: colors.destructive }]}>{notice}</Text>}
        {shamePro && <ProLock label="SHAME MODE" />}

        {showLoading && (
          <View style={[styles.emptyCard, { borderColor: colors.border }]}>
            <ActivityIndicator color={colors.primary} />
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>Loading operations.</Text>
          </View>
        )}

        {showError && (
          <View style={[styles.emptyCard, { borderColor: colors.border }]}>
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
              {offline ? "Offline. No cached board yet." : "The board could not be loaded."}
            </Text>
            <TouchableOpacity onPress={() => void refresh()} activeOpacity={0.7}>
              <Text style={[styles.clearFilterText, { color: colors.primary }]}>RETRY</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Generating state */}
        {showGenerating && <GeneratingState />}

        {/* Quest sections */}
        {!showGenerating && !showLoading && !showError && (
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
                  <QuestCard key={q.id} quest={q} onComplete={onComplete} onRefuse={setRefusing} onSlot={setSlotting} onBriefing={openBriefing} onShame={inClan ? onShame : undefined} refuseDisabled={refusalLimit} busy={busyIds.has(q.id)} />
                ))}
                {refusalLimit && (
                  <Text style={[styles.refusalNote, { color: colors.destructive }]}>{REFUSAL_RULE}</Text>
                )}
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
                  <QuestCard key={q.id} quest={q} onComplete={onComplete} onRefuse={setRefusing} onSlot={setSlotting} onBriefing={openBriefing} onShame={inClan ? onShame : undefined} refuseDisabled={refusalLimit} busy={busyIds.has(q.id)} />
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
                  <QuestCard key={q.id} quest={q} onComplete={onComplete} onShame={inClan ? onShame : undefined} busy={busyIds.has(q.id)} />
                ))}
              </View>
            )}

            {/* Active Quest Chains */}
            {activeChains.length > 0 && (
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>ACTIVE ARC CHAINS</Text>
                  <Text style={[styles.sectionMeta, { color: colors.mutedForeground }]}>
                    {activeChains.length} running
                  </Text>
                </View>
                {activeChains.map(chain => (
                  <QuestChainCard key={chain.id} chain={chain} />
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
                  <QuestCard key={q.id} quest={q} onComplete={onComplete} busy={busyIds.has(q.id)} />
                ))}
              </View>
            )}

            {/* Completed chains */}
            {completedChains.length > 0 && (
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>COMPLETED CHAINS</Text>
                  <Text style={[styles.sectionMeta, { color: "#4B8B6F" }]}>
                    {completedChains.length}
                  </Text>
                </View>
                {completedChains.map(chain => (
                  <QuestChainCard key={chain.id} chain={chain} />
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
                  <QuestCard key={q.id} quest={q} onComplete={onComplete} busy={busyIds.has(q.id)} />
                ))}
              </View>
            )}

            {/* Empty */}
            {totalActive === 0 && completedCount === 0 && (
              <View style={[styles.emptyCard, { borderColor: colors.border }]}>
                <Feather name="inbox" size={24} color={colors.mutedForeground} />
                <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Board empty.</Text>
                <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                  Pull down to check for new operations. THE SYSTEM issues the board once per day.
                </Text>
              </View>
            )}
          </>
        )}

        {/* Arc Chain Catalog */}
        <View style={styles.section}>
          <TouchableOpacity
            style={styles.catalogToggle}
            onPress={() => setShowChainCatalog(s => !s)}
            activeOpacity={0.7}
          >
            <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
              ARC CHAIN CATALOG
            </Text>
            <View style={[styles.catalogCount, { borderColor: colors.border }]}>
              <Text style={[styles.catalogCountText, { color: colors.mutedForeground }]}>
                {chainTemplates.length} CHAINS
              </Text>
            </View>
            <Feather
              name={showChainCatalog ? "chevron-up" : "chevron-down"}
              size={13} color={colors.mutedForeground}
            />
          </TouchableOpacity>
          {showChainCatalog && (
            <View style={styles.catalogList}>
              {chainTemplates.map(chain => {
                const alreadyStarted = questChains.some(
                  c => c.templateKey === chain.templateKey && c.status === "active"
                );
                return (
                  <QuestChainCatalogCard
                    key={chain.name}
                    chain={chain}
                    onStart={() => handleStartChain(chain)}
                    alreadyStarted={alreadyStarted}
                    busy={startingKey !== null}
                  />
                );
              })}
            </View>
          )}
        </View>

        {/* Manual refresh hint */}
        {!showGenerating && totalActive > 0 && (
          <TouchableOpacity onPress={onRefresh} activeOpacity={0.6} style={styles.refreshHint}>
            <Text style={[styles.refreshHintText, { color: colors.mutedForeground }]}>
              ↓ Pull to refresh
            </Text>
          </TouchableOpacity>
        )}
      </ScrollView>
      <SlotPicker
        visible={slotting !== null}
        questTitle={slotting?.title ?? ""}
        current={slotting?.slotStart && slotting.slotEnd ? { slotStart: slotting.slotStart, slotEnd: slotting.slotEnd } : null}
        suggestions={quiet.data ? quietChips(quiet.data.suggestions, localWeekday(new Date(), accountTz)) : undefined}
        hint={quietHint(quiet.data)}
        busy={slotBusy}
        onCancel={() => setSlotting(null)}
        onConfirm={(slot) => void saveSlot(slot)}
        onClear={() => void saveSlot(null)}
      />
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

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { paddingHorizontal: 20, gap: 12 },

  headerRow: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start",
  },
  title: { fontSize: 14, fontWeight: "700" as const, letterSpacing: 3 },
  subtitle: { fontSize: 9, letterSpacing: 1.5, marginTop: 3, fontWeight: "500" as const },
  headerRight: {},
  rateBadge: {
    borderWidth: 1, paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 2, alignItems: "center",
  },
  rateLabel: { fontSize: 7, letterSpacing: 2, fontWeight: "700" as const },
  rateValue: { fontSize: 16, fontWeight: "800" as const },

  calibrationBanner: { borderWidth: 1, borderRadius: 4, padding: 12 },
  calibRow: { flexDirection: "row", alignItems: "center" },
  calibItem: { flex: 1, alignItems: "center", gap: 3 },
  calibDiv: { width: StyleSheet.hairlineWidth, height: 24 },
  calibLabel: { fontSize: 7, letterSpacing: 1.5, fontWeight: "600" as const },
  calibValue: { fontSize: 11, fontWeight: "700" as const, letterSpacing: 0.5 },

  pressureBadge: {
    flexDirection: "row", alignItems: "center", gap: 7,
    borderWidth: 1, borderRadius: 3, paddingHorizontal: 12, paddingVertical: 8,
  },
  pressureText: {
    flex: 1, fontSize: 9, fontWeight: "700" as const, letterSpacing: 1.5, color: "#E05555",
  },
  filterBar: {
    borderWidth: 1,
    borderRadius: 3,
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  filterText: { fontSize: 10, letterSpacing: 1.2, fontWeight: "600" as const },
  clearFilterText: { fontSize: 10, letterSpacing: 1.5, fontWeight: "700" as const },

  rankUpSection: {
    borderWidth: 1, borderRadius: 6, padding: 14, gap: 10,
  },
  rankUpHeader: {
    flexDirection: "row", alignItems: "center", gap: 7,
  },
  rankUpLabel: { fontSize: 9, fontWeight: "800" as const, letterSpacing: 2, flex: 1 },
  rankUpPct: { fontSize: 11, fontWeight: "700" as const },
  rankUpDesc: { fontSize: 11, lineHeight: 17 },
  prepItem: {
    flexDirection: "row", alignItems: "flex-start", gap: 10,
    borderWidth: 1, borderRadius: 4, padding: 10,
  },
  prepNum: { width: 24, height: 24, borderRadius: 4, alignItems: "center", justifyContent: "center" },
  prepNumText: { fontSize: 10, fontWeight: "800" as const },
  prepTitle: { fontSize: 11, fontWeight: "700" as const, letterSpacing: 0.3, marginBottom: 3 },
  prepDesc: { fontSize: 10, lineHeight: 15 },
  prepDomain: {
    borderWidth: 1, paddingHorizontal: 6, paddingVertical: 3, borderRadius: 2, alignSelf: "flex-start",
  },
  prepDomainText: { fontSize: 8, fontWeight: "800" as const, letterSpacing: 1 },

  section: { gap: 8 },
  sectionHeader: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 2,
  },
  sectionLabel: { fontSize: 9, letterSpacing: 3, fontWeight: "700" as const },
  sectionMeta: { fontSize: 9, letterSpacing: 1, fontWeight: "600" as const },
  arcBadge: { borderWidth: 1, borderRadius: 2, paddingHorizontal: 6, paddingVertical: 2 },
  arcBadgeText: { fontSize: 7, letterSpacing: 2, fontWeight: "700" as const },

  catalogToggle: {
    flexDirection: "row", alignItems: "center", gap: 8,
  },
  catalogCount: {
    borderWidth: 1, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 2,
  },
  catalogCountText: { fontSize: 8, fontWeight: "700" as const, letterSpacing: 1.5 },
  catalogList: { gap: 10 },

  emptyCard: {
    borderWidth: 1, borderRadius: 6, alignItems: "center",
    paddingVertical: 48, paddingHorizontal: 24, gap: 10, marginTop: 8,
  },
  emptyTitle: { fontSize: 16, fontWeight: "600" as const, marginTop: 4 },
  emptyText: { fontSize: 12, textAlign: "center", lineHeight: 19 },
  notice: { fontSize: 11, lineHeight: 17, letterSpacing: 0.3 },
  refusalNote: { fontSize: 10, lineHeight: 15, letterSpacing: 0.3 },
  refreshHint: { alignItems: "center", paddingVertical: 8, marginTop: 4 },
  refreshHintText: { fontSize: 10, letterSpacing: 1 },
});
