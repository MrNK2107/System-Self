// Quests tab: one job, the list of what THE SYSTEM has issued. Today (dailies + bonus), This week (weeklies),
// Arcs (arc quests and chains). Each quest is a row; tapping it opens its detail sheet with the actions.
import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";

import { FloorQuestCard } from "@/components/FloorQuestCard";
import { ProLock } from "@/components/ProLock";
import { QuestRow } from "@/components/QuestCard";
import { ChainSheet, ChainTemplateRow, QuestChainRow } from "@/components/QuestChainCard";
import { RefuseSheet, REFUSAL_RULE } from "@/components/RefuseSheet";
import { SlotPicker } from "@/components/SlotPicker";
import { QuestSheet } from "@/components/quests/QuestSheet";
import { Sheet } from "@/components/quests/Sheet";
import { Button } from "@/components/ui/Button";
import { ListRow } from "@/components/ui/ListRow";
import { Screen } from "@/components/ui/Screen";
import { Segmented } from "@/components/ui/Segmented";
import { SystemWindow } from "@/components/ui/SystemWindow";
import { DOMAIN_COLORS } from "@/constants/domains";
import { space, type } from "@/constants/type";
import { useApp, type ChainTemplate, type Quest, type QuestChain, type RefuseOutcome } from "@/context/AppContext";
import { useAuth } from "@/context/AuthContext";
import { useMyClanQuery } from "@/hooks/useClan";
import { useColors } from "@/hooks/useColors";
import { useQuietHours } from "@/hooks/useDungeon";
import { useBillingStatusQuery } from "@/hooks/usePro";
import { useQuestScheduler } from "@/hooks/useQuestScheduler";
import { isProRequired } from "@/lib/api/pro";
import { isProStatus } from "@/lib/billing/core";
import { describeChallengeError } from "@/lib/challenges/challenges";
import { shadowTallyLine } from "@/lib/game/adherence";
import { localWeekday, quietChips, quietHint } from "@/lib/game/dungeon";
import { hasApiCode, isStaleFailure, isoWeekKey, mutationFailureLine, refuseFailureLine } from "@/lib/game/guards";
import { shadowGapLine } from "@/lib/game/quest-row";
import { nextRankOf, rankUpPrepItems, shouldShowRankUpPrep } from "@/lib/game/rank-prep";
import { questCompleteHaptic } from "@/lib/haptics";

const BONUS_LIMIT_LINE = "Bonus quests: 3 issued today. The limit resets tomorrow.";

type Tab = "today" | "week" | "arcs";
const TABS: { key: Tab; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "week", label: "This week" },
  { key: "arcs", label: "Arcs" },
];

/** Section heading inside a list (plain caps label; more space above than below). */
function SectionLabel({ children }: { children: string }) {
  const colors = useColors();
  return <Text style={[type.label, s.sectionLabel, { color: colors.mutedForeground }]}>{children}</Text>;
}

/** An empty list: one System line and one action. */
function EmptyLine({ line, action, onAction }: { line: string; action?: string; onAction?: () => void }) {
  const colors = useColors();
  return (
    <View style={s.empty}>
      <Text style={[type.body, { color: colors.mutedForeground }]}>{line}</Text>
      {action && onAction ? <Button label={action} variant="tonal" onPress={onAction} /> : null}
    </View>
  );
}

export default function QuestsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ domain?: string }>();
  const colors = useColors();
  const {
    quests, completeQuest, refuseQuest, setQuestSlot, setQuestShame, requestBonusQuest, shadowSelf,
    questChains, chainTemplates, startQuestChain, user, tierProgress,
    loading, loadError, questsLoadError, refresh, offline,
  } = useApp();
  const { generating, triggerGeneration } = useQuestScheduler();
  // Quiet-hours chips are for the account's weekday (its timezone, as the server records reports), else the device's.
  const accountTz = useAuth().user?.timezone;

  const [tab, setTab] = useState<Tab>("today");
  const [refreshing, setRefreshing] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedChainId, setSelectedChainId] = useState<string | null>(null);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [template, setTemplate] = useState<ChainTemplate | null>(null);
  const [prepOpen, setPrepOpen] = useState(false);
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
  // Quests with a request in flight: repeats are ignored and the sheet's buttons are disabled.
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
  // PRO bonus quests: a free account (known from billing status, or after the server's 402) sees the PRO lock.
  const billing = useBillingStatusQuery().data;
  const knownPro = isProStatus(billing);
  const knownFree = billing !== undefined && !knownPro; // an expired `pro` counts as free
  const [bonusPro, setBonusPro] = useState(false);
  // A 402 seen before an upgrade must not keep the lock up once PRO is known.
  useEffect(() => {
    if (knownPro) setBonusPro(false);
  }, [knownPro]);
  const [bonusBusy, setBonusBusy] = useState(false);

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
      if (r.ok) {
        questCompleteHaptic();
        setSelectedId((cur) => (cur === id ? null : cur));
      } else if (!isStale(r)) setNotice(describeFailure(r));
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

  const onRequestBonus = async () => {
    if (bonusBusy) return;
    setBonusBusy(true);
    setNotice(null);
    try {
      const r = await requestBonusQuest();
      if (r.ok) return;
      if (r.reason === "error" && isProRequired(r.error)) setBonusPro(true);
      else if (r.reason === "error" && hasApiCode(r.error, "bonus_limit")) setNotice(BONUS_LIMIT_LINE);
      else setNotice(describeFailure(r));
    } finally {
      setBonusBusy(false);
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

  const handleStartChain = async (t: ChainTemplate) => {
    if (startingKey) return;
    if (questChains.some((c) => c.templateKey === t.templateKey && c.status === "active")) return;
    setStartingKey(t.templateKey);
    setNotice(null);
    try {
      const r = await startQuestChain(t.templateKey);
      if (r.ok) {
        setTemplate(null);
        return;
      }
      // chain_active: another device started it; the refetch that follows shows it as active.
      if (r.reason === "error" && hasApiCode(r.error, "chain_active")) setNotice("Chain already active.");
      else setNotice(describeFailure(r));
    } finally {
      setStartingKey(null);
    }
  };

  const domainFilter = (
    params.domain === "BODY" ||
    params.domain === "MIND" ||
    params.domain === "WEALTH" ||
    params.domain === "SOCIAL" ||
    params.domain === "DISCIPLINE"
  ) ? params.domain : null;

  const visibleQuests = domainFilter ? quests.filter((q) => q.domain === domainFilter) : quests;

  // Bonus quests have no rank effect: they stay out of every count below.
  const rankQuests = visibleQuests.filter((q) => !q.bonus);
  const activeBonus = visibleQuests.filter((q) => q.bonus && q.status === "active");
  const resolvedBonus = visibleQuests.filter((q) => q.bonus && q.status !== "active");
  const byType = (t: Quest["type"]) => rankQuests.filter((q) => q.type === t);
  const activeOf = (list: Quest[]) => list.filter((q) => q.status === "active");
  const resolvedOf = (list: Quest[]) => list.filter((q) => q.status !== "active");
  const dailies = byType("daily");
  const weeklies = byType("weekly");
  const arcs = byType("arc");
  const activeDailies = activeOf(dailies);
  const activeWeeklies = activeOf(weeklies);
  const activeArcs = activeOf(arcs);
  const totalActive = activeDailies.length + activeWeeklies.length + activeArcs.length;
  const doneToday = dailies.filter((q) => q.status === "complete").length;

  const showGenerating = generating && totalActive === 0;
  const showLoading = loading && quests.length === 0;
  const showError = (!!loadError || !!questsLoadError) && quests.length === 0 && !loading;

  // The Shadow's lead, in plain words; hidden when there is none.
  const shadowLine = shadowGapLine(shadowSelf.gap);

  // Rank-up prep only when the data supports it (a week on record and 75% through the band): lib/game/rank-prep.
  const rank = user?.rank ?? "E";
  const nextRank = nextRankOf(rank);
  const showRankUpPrep = shouldShowRankUpPrep({ rank, tierProgress, dayNumber: user?.dayNumber });
  const prepItems = rankUpPrepItems(rank);

  const activeChains = questChains.filter((c) => c.status === "active");
  const completedChains = questChains.filter((c) => c.status === "complete");
  const selectedQuest = selectedId ? quests.find((q) => q.id === selectedId) ?? null : null;
  const selectedChain = selectedChainId ? questChains.find((c) => c.id === selectedChainId) ?? null : null;

  // Next board: 04:00 tomorrow.
  const nextGen = new Date();
  nextGen.setDate(nextGen.getDate() + 1);
  nextGen.setHours(4, 0, 0, 0);
  const nextGenStr = nextGen.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  // What the sheet offers depends on the quest's kind (as the old cards did).
  const sheetActions = (q: Quest) => {
    const refuse = (x: Quest) => {
      setSelectedId(null);
      setRefusing(x);
    };
    if (q.bonus) return { onRefuse: refuse };
    const shame = inClan ? onShame : undefined;
    if (q.type === "arc") return { onShame: shame };
    return {
      onSlot: (x: Quest) => {
        setSelectedId(null);
        setSlotting(x);
      },
      onBriefing: () => {
        setSelectedId(null);
        openBriefing();
      },
      onShame: shame,
      onRefuse: refuse,
      refuseDisabled: refusalLimit,
    };
  };

  const open = (q: Quest) => {
    setNotice(null);
    setSelectedId(q.id);
  };
  const rows = (list: Quest[]) => list.map((q) => <QuestRow key={q.id} quest={q} onPress={open} />);
  const listReady = !showGenerating && !showLoading && !showError;

  return (
    <Screen title="Quests" tab refreshing={refreshing} onRefresh={() => void onRefresh()}>
      <Segmented options={TABS} value={tab} onChange={setTab} />

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
        <View style={s.flush}>
          <ListRow
            title={`Showing ${domainFilter} only`}
            dot={DOMAIN_COLORS[domainFilter]}
            trailing={<Button label="Clear" variant="text" onPress={() => router.replace("/(tabs)/quests")} />}
          />
        </View>
      )}

      {notice && !selectedQuest ? <Text style={[type.meta, { color: colors.destructive }]}>{notice}</Text> : null}

      {showLoading && (
        <View style={s.empty}>
          <ActivityIndicator color={colors.primary} />
          <Text style={[type.body, { color: colors.mutedForeground }]}>Loading quests.</Text>
        </View>
      )}

      {showError && (
        <EmptyLine
          line={offline ? "Offline. No saved quest list on this device yet." : "The quest list could not be loaded."}
          action="Retry"
          onAction={() => void refresh()}
        />
      )}

      {showGenerating && (
        <SystemWindow title="TRANSMITTING">
          <Text style={[type.body, s.center, { color: colors.foreground }]}>THE SYSTEM is issuing today's quests.</Text>
          <ActivityIndicator color={colors.primary} />
        </SystemWindow>
      )}

      {listReady && tab === "today" && (
        <>
          <View style={s.block}>
            <Text style={[type.meta, { color: colors.mutedForeground }]}>
              {`${doneToday} of ${dailies.length} done today · new quests at ${nextGenStr}`}
            </Text>
            {shadowLine ? <Text style={[type.meta, { color: colors.mutedForeground }]}>{shadowLine}</Text> : null}
          </View>

          <View style={s.flush}>
            {activeDailies.length + activeBonus.length > 0 ? (
              <>
                {rows(activeDailies)}
                {rows(activeBonus)}
              </>
            ) : (
              <EmptyLine
                line={dailies.length > 0 ? "Every quest today is resolved." : "No quests issued today. Pull down to check again."}
                action={dailies.length > 0 ? undefined : "Check now"}
                onAction={() => void onRefresh()}
              />
            )}
          </View>
          {refusalLimit && activeDailies.length > 0 ? (
            <Text style={[type.meta, { color: colors.mutedForeground }]}>{REFUSAL_RULE}</Text>
          ) : null}

          <SystemWindow title="BONUS">
            <Text style={[type.body, s.center, { color: colors.mutedForeground }]}>
              {knownFree || bonusPro ? "Bonus quests are PRO. Up to 3 a day, no rank effect." : "Up to 3 a day. No rank effect."}
            </Text>
            <View style={s.centerRow}>
              {knownFree || bonusPro ? (
                <ProLock label="BONUS QUEST" />
              ) : (
                <Button
                  label="Request bonus quest"
                  variant="tonal"
                  onPress={() => void onRequestBonus()}
                  loading={bonusBusy}
                  accessibilityLabel="Request bonus quest"
                />
              )}
            </View>
          </SystemWindow>

          {showRankUpPrep && nextRank && prepItems.length > 0 ? (
            <View style={s.flush}>
              <ListRow
                title={`Rank-up prep: rank ${nextRank}`}
                subtitle={`${Math.round(tierProgress)}% through rank ${rank}. ${prepItems.length} things THE SYSTEM looks for.`}
                dot={colors.rank[nextRank]}
                chevron
                onPress={() => setPrepOpen(true)}
              />
            </View>
          ) : null}

          {resolvedOf(dailies).length + resolvedBonus.length > 0 ? (
            <View>
              <SectionLabel>RESOLVED TODAY</SectionLabel>
              <View style={s.flush}>
                {rows(resolvedOf(dailies))}
                {rows(resolvedBonus)}
              </View>
            </View>
          ) : null}

          <View style={s.flush}>
            <ListRow
              title="Custom stats"
              subtitle="Track anything with a number. Separate from rank."
              chevron
              onPress={() => router.push("/custom")}
            />
          </View>
        </>
      )}

      {listReady && tab === "week" && (
        <>
          <View style={s.flush}>
            {activeWeeklies.length > 0 ? (
              rows(activeWeeklies)
            ) : (
              <EmptyLine line="No weekly quest is open. THE SYSTEM issues them at the start of the week." />
            )}
          </View>
          {resolvedOf(weeklies).length > 0 ? (
            <View>
              <SectionLabel>RESOLVED</SectionLabel>
              <View style={s.flush}>{rows(resolvedOf(weeklies))}</View>
            </View>
          ) : null}
        </>
      )}

      {listReady && tab === "arcs" && (
        <>
          {activeArcs.length > 0 || activeChains.length > 0 ? (
            <View style={s.flush}>
              {rows(activeArcs)}
              {activeChains.map((c) => (
                <QuestChainRow key={c.id} chain={c} onPress={(x: QuestChain) => setSelectedChainId(x.id)} />
              ))}
            </View>
          ) : (
            <EmptyLine line="No arc is running. Start a chain: several steps, one domain." action="Browse chains" onAction={() => setCatalogOpen(true)} />
          )}

          {resolvedOf(arcs).length + completedChains.length > 0 ? (
            <View>
              <SectionLabel>FINISHED</SectionLabel>
              <View style={s.flush}>
                {completedChains.map((c) => (
                  <QuestChainRow key={c.id} chain={c} onPress={(x: QuestChain) => setSelectedChainId(x.id)} />
                ))}
                {rows(resolvedOf(arcs))}
              </View>
            </View>
          ) : null}

          <View style={s.flush}>
            <ListRow
              title="Arc chain catalog"
              subtitle={`${chainTemplates.length} chains to start`}
              chevron
              onPress={() => setCatalogOpen(true)}
            />
          </View>
        </>
      )}

      <QuestSheet
        quest={selectedQuest}
        busy={selectedQuest ? busyIds.has(selectedQuest.id) : false}
        notice={notice}
        onClose={() => setSelectedId(null)}
        onComplete={(id) => void onComplete(id)}
        shameLocked={shamePro}
        {...(selectedQuest && selectedQuest.status === "active" ? sheetActions(selectedQuest) : {})}
      />

      <ChainSheet chain={selectedChain} template={null} onClose={() => setSelectedChainId(null)} />

      <Sheet visible={catalogOpen} title="Arc chains" onClose={() => setCatalogOpen(false)}>
        <Text style={[type.meta, { color: colors.mutedForeground }]}>Each chain is a run of quests in one domain. One active chain per kind.</Text>
        <View style={s.sheetList}>
          {chainTemplates.map((t) => (
            <ChainTemplateRow
              key={t.templateKey}
              template={t}
              started={questChains.some((c) => c.templateKey === t.templateKey && c.status === "active")}
              onPress={(x) => {
                setCatalogOpen(false);
                setTemplate(x);
              }}
            />
          ))}
        </View>
      </Sheet>

      <ChainSheet
        chain={null}
        template={template}
        onClose={() => setTemplate(null)}
        onStart={(t) => void handleStartChain(t)}
        alreadyStarted={!!template && questChains.some((c) => c.templateKey === template.templateKey && c.status === "active")}
        busy={startingKey !== null}
      />

      <Sheet visible={prepOpen} title={nextRank ? `Rank-up prep: rank ${nextRank}` : "Rank-up prep"} onClose={() => setPrepOpen(false)}>
        <Text style={[type.body, { color: colors.mutedForeground }]}>
          {`You are ${Math.round(tierProgress)}% through rank ${rank}. THE SYSTEM decides promotion. This is what it looks for.`}
        </Text>
        <View style={s.sheetList}>
          {prepItems.map((item) => (
            <ListRow key={item.title} title={item.title} subtitle={item.description} dot={DOMAIN_COLORS[item.domain]} />
          ))}
        </View>
      </Sheet>

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
    </Screen>
  );
}

const s = StyleSheet.create({
  /** Rows run edge to edge of the screen's 16dp gutter. */
  flush: { marginHorizontal: -space.md },
  block: { gap: space.xs },
  sectionLabel: { marginTop: space.sm, marginBottom: space.xs },
  empty: { alignItems: "flex-start", gap: space.md, paddingVertical: space.lg, paddingHorizontal: space.md },
  center: { textAlign: "center" },
  centerRow: { alignItems: "center" },
  sheetList: { marginHorizontal: -space.md, marginTop: space.sm },
});
