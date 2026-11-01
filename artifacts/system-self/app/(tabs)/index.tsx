// Today: one job, "what do I do next". THE SYSTEM's briefing, the one next quest, a quiet row to the rest, and at
// most one contextual card. Stats and rank live on Status; logging is the centre tab.
import React, { useCallback, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { needsSessionProof } from "@workspace/engine";
import { useQuery } from "@tanstack/react-query";
import { Screen } from "@/components/ui/Screen";
import { SystemWindow } from "@/components/ui/SystemWindow";
import { Button } from "@/components/ui/Button";
import { ListRow } from "@/components/ui/ListRow";
import { SystemMessage } from "@/components/SystemMessage";
import { NightlyDebriefModal } from "@/components/NightlyDebriefModal";
import { ShadowConfrontationModal } from "@/components/ShadowConfrontationModal";
import { RefuseSheet } from "@/components/RefuseSheet";
import { FloorQuestCard } from "@/components/FloorQuestCard";
import { ComebackCard } from "@/components/ComebackCard";
import { DuoCard } from "@/components/DuoCard";
import { NextQuestCard, type QuestAction } from "@/components/today/NextQuestCard";
import { VouchInbox } from "@/components/today/VouchInbox";
import { ShadowAlert } from "@/components/today/ShadowAlert";
import { space, type } from "@/constants/type";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";
import { useAuth } from "@/context/AuthContext";
import { useComebackQuery, useGameStateQuery, useGameUserId } from "@/hooks/useGameState";
import { useNightlyDebrief } from "@/hooks/useNightlyDebrief";
import { useDuoQuery } from "@/hooks/useDuo";
import { useLogSheet } from "@/hooks/useLogSheet";
import { hasDuoActivity } from "@/lib/duo/duo";
import { seasonChipLine } from "@/lib/game/life";
import { api } from "@/lib/api/client";
import { briefingKey } from "@/lib/game/keys";
import { fallbackMessage, msUntilLocalMidnight, tryFetchMessage } from "@/lib/game/messages";
import { shadowTallyLine } from "@/lib/game/adherence";
import { missedSlotLine, missedSlotQuest, slotStateStale } from "@/lib/game/slots";
import { isStaleFailure, mutationFailureLine, refuseFailureLine } from "@/lib/game/guards";
import { deadlineLine, formatReward, pickContextCard, pickNextQuest, questReward } from "@/lib/game/today";
import { questCompleteHaptic } from "@/lib/haptics";
import type { Quest, RefuseOutcome } from "@/context/AppContext";

function localDateString(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

const openQuests = () => router.navigate("/(tabs)/quests");

export default function Today() {
  const colors = useColors();
  const userId = useGameUserId();
  const { openLog } = useLogSheet();
  const { user, quests, shadowSelf, loading, loadError, refresh, refuseQuest, completeQuest, questsUpdatedAt } = useApp();
  const { pendingDebrief, acknowledgeDebrief, debriefText } = useNightlyDebrief();
  const comeback = useComebackQuery().data?.active ?? null;
  const gameState = useGameStateQuery().data;
  const season = gameState?.profile.season ?? null;
  const duoActive = hasDuoActivity(useDuoQuery().data);

  const [refreshing, setRefreshing] = useState(false);
  const [confrontVisible, setConfrontVisible] = useState(false);
  const [refusing, setRefusing] = useState<Quest | null>(null);
  const [refuseBusy, setRefuseBusy] = useState(false);
  const [floorOffer, setFloorOffer] = useState<(RefuseOutcome & { questId: string }) | null>(null);
  const [refuseError, setRefuseError] = useState<string | null>(null);
  const [completing, setCompleting] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showDebrief, setShowDebrief] = useState(false);
  const inFlight = useRef(false);

  // The clock re-reads once a minute so a slot that lapses (or a deadline that nears) while the app is open shows up.
  // Times and dates are read in the account timezone (as the server judges slots), else the device's.
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

  const missed = missedSlotQuest(quests, clock, computedAt, accountTz);
  // A refuse failure belongs to the missed slot it was raised from: when that quest changes or goes, so does the line.
  const missedId = missed?.id ?? null;
  React.useEffect(() => {
    setRefuseError(null);
  }, [missedId]);

  const { quest: next, more } = pickNextQuest(quests, missed);

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

  const onComplete = async (id: string) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setCompleting(id);
    setNotice(null);
    try {
      const r = await completeQuest(id);
      if (r.ok) questCompleteHaptic();
      else if (!isStaleFailure(r)) setNotice(mutationFailureLine(r));
    } finally {
      inFlight.current = false;
      setCompleting(null);
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

  if (!user) {
    return (
      <Screen title="Today" tab>
        {loading || !loadError ? (
          <ActivityIndicator color={colors.primary} style={s.loading} />
        ) : (
          <SystemWindow title="NO SIGNAL">
            <Text style={[type.title, { color: colors.foreground }]}>The System is out of reach. Check your connection.</Text>
            <Button label="Retry" onPress={() => void refresh()} block style={s.windowAction} />
          </SystemWindow>
        )}
      </Screen>
    );
  }

  // The next quest's actions. BODY quests start with the dungeon briefing; others complete in place.
  // A missed slot keeps its "Not today" (refuse) here; every other refusal lives on the Quests tab.
  let card: React.ReactNode = null;
  if (next) {
    const isMissed = missed?.id === next.id;
    const complete: QuestAction = { label: "Mark complete", onPress: () => void onComplete(next.id) };
    const toBriefing = () => router.push("/dungeon/briefing");
    let primary: QuestAction;
    const secondary: QuestAction[] = [];
    const proofOnly = needsSessionProof(next.target);
    const toSession = () => router.push({ pathname: "/session/[questId]", params: { questId: next.id } });
    if (proofOnly) {
      // Proven by a live session only (spec 8.2): no tap-to-complete.
      primary = { label: "Start session", onPress: toSession, accessibilityLabel: "Start a live session to prove this quest" };
      if (next.domain === "BODY") secondary.push({ label: "Briefing", onPress: toBriefing });
      if (isMissed) secondary.push({ label: "Not today", onPress: () => setRefusing(next) });
    } else if (isMissed) {
      primary = { label: "Go now", onPress: toBriefing };
      secondary.push(complete, { label: "Not today", onPress: () => setRefusing(next) });
    } else if (next.domain === "BODY") {
      primary = { label: "Start", onPress: toBriefing, accessibilityLabel: "Start: open the briefing" };
      secondary.push(complete);
    } else {
      primary = { label: "Complete", onPress: complete.onPress, accessibilityLabel: "Mark complete" };
      secondary.push({ label: "Details", onPress: openQuests, accessibilityLabel: "Open on the Quests tab" });
    }
    const reward = questReward(next, gameState?.scores.find((sc) => sc.domain === next.domain)?.score);
    card = (
      <NextQuestCard
        quest={next}
        reward={reward ? { delta: formatReward(reward.delta), domain: reward.domain } : null}
        status={
          isMissed && next.slotStart
            ? { text: missedSlotLine(next.slotStart, clock, accountTz), urgent: true }
            : deadlineLine(next.expiresAt, clock, accountTz)
        }
        primary={primary}
        secondary={secondary}
        busy={completing === next.id}
      />
    );
  }

  const context = pickContextCard({
    shadow: shadowSelf.active,
    comeback: !!comeback,
    duo: duoActive,
    floor: !!floorOffer?.floor,
  });

  const rankQuests = quests.filter((q) => !q.bonus);
  const resolvedAll = rankQuests.length > 0 && rankQuests.every((q) => q.status !== "active");

  return (
    <Screen title={`Day ${user.dayNumber}`} tab refreshing={refreshing} onRefresh={() => void onRefresh()}>
      {pendingDebrief && (
        <NightlyDebriefModal
          visible={!!pendingDebrief}
          debrief={pendingDebrief}
          username={user.username}
          dayNumber={user.dayNumber}
          onAcknowledge={acknowledgeDebrief}
        />
      )}
      <ShadowConfrontationModal visible={confrontVisible} onClose={() => setConfrontVisible(false)} />

      <SystemWindow title={showDebrief && debriefText ? "NIGHTLY DEBRIEF" : "MORNING BRIEFING"}>
        {showDebrief && debriefText ? (
          <SystemMessage message={debriefText} animate={!refreshing} />
        ) : briefingQ.isPending && !briefing ? (
          <ActivityIndicator color={colors.primary} style={s.windowLoading} />
        ) : briefing ? (
          <SystemMessage message={briefing} animate={!refreshing} />
        ) : (
          <Text style={[type.title, { color: colors.mutedForeground }]}>Receiving transmission.</Text>
        )}
        {debriefText ? (
          <Button
            label={showDebrief ? "Morning briefing" : "Last night's debrief"}
            variant="text"
            onPress={() => setShowDebrief((v) => !v)}
            style={s.windowToggle}
          />
        ) : null}
      </SystemWindow>

      <View style={s.section}>
        <VouchInbox />
        {card ?? (
          <View style={[s.empty, { borderColor: colors.border, backgroundColor: colors.card }]}>
            <Text style={[type.body, { color: colors.foreground }]}>
              {resolvedAll ? "Every quest today is resolved. Log what else you do." : "No active quests. Log what you do; the System is watching."}
            </Text>
            <Button label="Log something" onPress={openLog} block />
          </View>
        )}
        {notice ? (
          <Text style={[type.meta, { color: colors.destructive }]} accessibilityLiveRegion="polite">
            {notice}
          </Text>
        ) : null}
        {refuseError ? (
          <Text style={[type.meta, { color: colors.destructive }]} accessibilityLiveRegion="polite">
            {refuseError}
          </Text>
        ) : null}
        {more > 0 ? (
          <ListRow
            title={`${more} more quest${more === 1 ? "" : "s"} today`}
            chevron
            onPress={openQuests}
            accessibilityLabel={`${more} more quests today. Open Quests.`}
          />
        ) : null}
        {season ? <ListRow title={seasonChipLine(season).title} subtitle={seasonChipLine(season).meta} /> : null}
      </View>

      {context === "shadow" && <ShadowAlert onConfront={() => setConfrontVisible(true)} />}
      {context === "comeback" && comeback && <ComebackCard gapDays={comeback.gapDays} checklist={comeback.checklist} />}
      {context === "duo" && <DuoCard />}
      {context === "floor" && floorOffer?.floor && (
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

      <RefuseSheet
        visible={refusing !== null}
        questTitle={refusing?.title ?? ""}
        busy={refuseBusy}
        onCancel={() => setRefusing(null)}
        onConfirm={(reason) => void confirmRefuse(reason)}
      />
    </Screen>
  );
}

const s = StyleSheet.create({
  loading: { marginTop: space.xxl },
  windowAction: { marginTop: space.sm },
  windowLoading: { alignSelf: "flex-start", marginVertical: space.xs },
  windowToggle: { alignSelf: "flex-start", marginLeft: -space.sm - 4, marginBottom: -space.sm },
  section: { gap: space.sm },
  empty: { borderWidth: 1, borderRadius: 4, padding: space.md, gap: space.md },
});
