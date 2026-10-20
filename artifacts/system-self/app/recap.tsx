// Weekly recap: the System's review of the current week. Before a week has closed it says so instead of
// reviewing days that have not happened (no red zeros on day 1).
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { ScreenStatus } from "@/components/ScreenStatus";
import { SystemMessage } from "@/components/SystemMessage";
import { Figure, ProgressLine, Section, SystemLine } from "@/components/status/parts";
import { Button } from "@/components/ui/Button";
import { ListRow } from "@/components/ui/ListRow";
import { Screen } from "@/components/ui/Screen";
import { SystemWindow } from "@/components/ui/SystemWindow";
import { ALL_DOMAINS as DOMAINS, DOMAIN_COLORS } from "@/constants/domains";
import { space, type } from "@/constants/type";
import { useApp, ACHIEVEMENT_DEFS, type Domain } from "@/context/AppContext";
import { useColors } from "@/hooks/useColors";
import { useGameUserId } from "@/hooks/useGameState";
import { api } from "@/lib/api/client";
import { weeklyDebriefKey, weeklyRecapKey } from "@/lib/game/keys";
import { fetchWeeklyDebrief, fetchWeeklyRecap } from "@/lib/game/messages";
import { RECAP_FIRST_DAY, RECAP_NOT_READY_LINE, formatChange, recapReady } from "@/lib/status/status";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function DeltaRow({ domain, delta, max }: { domain: Domain; delta: number; max: number }) {
  const colors = useColors();
  const color = DOMAIN_COLORS[domain];
  const pct = max > 0 && delta > 0 ? (delta / max) * 100 : 0;
  return (
    <View style={s.delta} accessible accessibilityLabel={`${domain} ${formatChange(delta)} this week`}>
      <View style={[s.dot, { backgroundColor: color }]} />
      <Text style={[type.label, s.deltaName, { color: colors.foreground }]}>{domain}</Text>
      <ProgressLine value={pct} color={color} />
      <Text style={[type.meta, s.deltaValue, { color: delta > 0 ? colors.success : delta < 0 ? colors.destructive : colors.mutedForeground }]}>
        {formatChange(delta)}
      </Text>
    </View>
  );
}

export default function RecapScreen() {
  const colors = useColors();
  const { user, shadowSelf, achievements, questChains, getShadowPhase, loading, loadError, refresh } = useApp();
  const userId = useGameUserId();
  const ready = !!user && recapReady(user.dayNumber);

  const recapQ = useQuery({ queryKey: weeklyRecapKey(userId), queryFn: () => fetchWeeklyRecap(api), enabled: !!userId });
  const verdictQ = useQuery({
    queryKey: weeklyDebriefKey(userId),
    queryFn: () => fetchWeeklyDebrief(api),
    enabled: !!userId && ready,
    staleTime: 5 * 60_000,
  });
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([recapQ.refetch(), ready ? verdictQ.refetch() : Promise.resolve()]);
    } finally {
      setRefreshing(false);
    }
  };

  if (!user) {
    return <ScreenStatus failed={!loading && !!loadError} message="The System is out of reach. Check your connection." onRetry={() => void refresh()} />;
  }

  if (!ready) {
    const left = RECAP_FIRST_DAY - user.dayNumber;
    return (
      <Screen title="Weekly recap" back>
        <SystemWindow title="WEEKLY RECAP">
          <Text style={[type.title, { color: colors.foreground }]}>{RECAP_NOT_READY_LINE}</Text>
          <Text style={[type.body, { color: colors.mutedForeground }]}>
            {`Day ${user.dayNumber}. ${left === 1 ? "One more day" : `${left} more days`} until the System reviews your first week.`}
          </Text>
        </SystemWindow>
        <ListRow title="Log history" subtitle="What you have logged so far" chevron onPress={() => router.push("/history")} />
      </Screen>
    );
  }

  const recap = recapQ.data;
  if (!recap) {
    return <ScreenStatus failed={recapQ.isError} message="The weekly record is out of reach. Check your connection." onRetry={() => void recapQ.refetch()} />;
  }

  const aiVerdict = verdictQ.data?.debrief ?? "";
  const maxDelta = Math.max(...DOMAINS.map((d) => recap.domainDeltas[d]), 0.1);
  const weekDate = new Date(recap.weekStart + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const shadowPhase = getShadowPhase();
  const unlockedThisWeek = achievements.filter((a) => a.unlockedAt && Date.now() - new Date(a.unlockedAt).getTime() < WEEK_MS);

  return (
    <Screen title="Weekly recap" back refreshing={refreshing} onRefresh={() => void onRefresh()}>
      <SystemWindow title={`WEEK OF ${weekDate.toUpperCase()}`}>
        {verdictQ.isPending ? (
          <SystemLine>Generating assessment.</SystemLine>
        ) : aiVerdict ? (
          <SystemMessage message={aiVerdict} animate={!refreshing} />
        ) : (
          <>
            <SystemLine>The verdict is out of reach.</SystemLine>
            <Button label="Retry" variant="text" onPress={() => void verdictQ.refetch()} />
          </>
        )}
      </SystemWindow>

      <View style={s.figures}>
        <Figure label="LOGS" value={recap.logsCount} />
        <Figure label="DONE" value={recap.questsCompleted} />
        <Figure label="FAILED" value={recap.questsFailed} color={recap.questsFailed > 0 ? colors.destructive : undefined} />
        <Figure label="REFUSED" value={recap.questsRefused} />
      </View>

      <Section title="Score movement this week" trailing={recap.peakDomain ? <Text style={[type.label, { color: DOMAIN_COLORS[recap.peakDomain] }]}>{`PEAK ${recap.peakDomain}`}</Text> : undefined}>
        <View style={s.deltas}>
          {DOMAINS.map((d) => (
            <DeltaRow key={d} domain={d} delta={recap.domainDeltas[d]} max={maxDelta} />
          ))}
        </View>
      </Section>

      {recap.forbiddenLogs > 0 && (
        <Text style={[type.body, { color: colors.destructive }]}>
          {`${recap.forbiddenLogs} forbidden ${recap.forbiddenLogs === 1 ? "log" : "logs"} this week.`}
        </Text>
      )}

      <Section title="Shadow self" trailing={<Text style={[type.label, { color: colors.mutedForeground }]}>{shadowPhase}</Text>}>
        {shadowSelf.active ? (
          <>
            <Text style={[type.number, { color: shadowSelf.gap > 0 ? colors.destructive : colors.success }]}>
              {shadowSelf.gap > 0 ? `${shadowSelf.gap.toFixed(1)} points ahead of you` : `${Math.abs(shadowSelf.gap).toFixed(1)} points behind you`}
            </Text>
            <Text style={[type.body, { color: colors.mutedForeground }]}>
              {shadowPhase === "DOMINANT"
                ? "The Shadow has established dominance. Extreme countermeasures required."
                : shadowPhase === "HUNTING"
                  ? "It is closing in. Two weeks of consistent logging closes this gap."
                  : "Shadow Self is active. It gains daily. Your consistency determines the outcome."}
            </Text>
          </>
        ) : (
          <SystemLine>Shadow Self not active. When active, it grows daily at a preset rate.</SystemLine>
        )}
      </Section>

      {questChains.length > 0 && (
        <Section title="Arcs this week">
          {questChains.slice(-4).map((chain) => {
            const color = DOMAIN_COLORS[chain.domain];
            const done = chain.status === "complete";
            const progress = chain.totalSteps > 0 ? (Math.min(chain.totalSteps, chain.currentStep) / chain.totalSteps) * 100 : 0;
            return (
              <View key={chain.id} style={s.chain} accessible accessibilityLabel={`${chain.name}, ${done ? "done" : `step ${chain.currentStep} of ${chain.totalSteps}`}`}>
                <View style={s.chainHead}>
                  <View style={[s.dot, { backgroundColor: color }]} />
                  <Text style={[type.body, s.flex, { color: colors.foreground }]}>{chain.name}</Text>
                  <Text style={[type.meta, { color: done ? colors.success : colors.mutedForeground }]}>{done ? "Done" : `${chain.currentStep}/${chain.totalSteps}`}</Text>
                </View>
                <ProgressLine value={progress} color={color} />
              </View>
            );
          })}
        </Section>
      )}

      {unlockedThisWeek.length > 0 && (
        <Section title="Unlocked this week">
          {unlockedThisWeek.map((a) => (
            <Text key={a.id} style={[type.body, { color: colors.foreground }]}>
              {ACHIEVEMENT_DEFS[a.id].title}
            </Text>
          ))}
        </Section>
      )}

      <ListRow
        title="All achievements"
        subtitle={`${achievements.filter((a) => a.unlockedAt !== null).length} of ${achievements.length} unlocked`}
        chevron
        onPress={() => router.push({ pathname: "/stats", params: { section: "awards" } })}
      />
    </Screen>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1 },
  figures: { flexDirection: "row", paddingVertical: space.sm },
  deltas: { gap: space.sm + 4 },
  delta: { flexDirection: "row", alignItems: "center", gap: space.sm },
  deltaName: { width: 96 },
  deltaValue: { width: 44, textAlign: "right" },
  dot: { width: 8, height: 8, borderRadius: 4 },
  chain: { gap: space.xs, paddingVertical: space.xs },
  chainHead: { flexDirection: "row", alignItems: "center", gap: space.sm },
});
