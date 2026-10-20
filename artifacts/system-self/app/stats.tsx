// Full stats: the long record behind Status, split into four sections so no one view is a wall.
// Overview (a line of counts, rank progress, performance, calendar, shadow), History (charts, Rank Freeze),
// Awards (achievements, milestones), Debrief (nightly debrief, deferral ledger).
import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { HistoryPanel, RankFreezeCard } from "@/components/HistoryPanel";
import { ScreenStatus } from "@/components/ScreenStatus";
import { StreakCalendar } from "@/components/StreakCalendar";
import { SystemMessage } from "@/components/SystemMessage";
import { ProgressLine, Section, SystemLine } from "@/components/status/parts";
import { Button } from "@/components/ui/Button";
import { ListRow } from "@/components/ui/ListRow";
import { Screen } from "@/components/ui/Screen";
import { Segmented } from "@/components/ui/Segmented";
import { SystemWindow } from "@/components/ui/SystemWindow";
import { ALL_DOMAINS as DOMAINS, DOMAIN_COLORS } from "@/constants/domains";
import { space, type } from "@/constants/type";
import { useApp, ACHIEVEMENT_DEFS, MILESTONE_TITLES, type Domain, type MilestoneTier } from "@/context/AppContext";
import { useColors } from "@/hooks/useColors";
import { useDeferralsQuery, useGameUserId } from "@/hooks/useGameState";
import { api } from "@/lib/api/client";
import { LEDGER_HEADER, ledgerLine } from "@/lib/game/adherence";
import { completionSummaryKey, debriefKey } from "@/lib/game/keys";
import { fetchCompletionSummary, fetchDebriefToday } from "@/lib/game/messages";
import { shouldShowRankUpPrep } from "@/lib/game/rank-prep";
import { overviewLine, performanceLine, rankLine } from "@/lib/status/status";

const MILESTONE_TIERS: MilestoneTier[] = [60, 70, 80, 90, 100];

type Tab = "overview" | "history" | "awards" | "debrief";
const TABS: { key: Tab; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "history", label: "History" },
  { key: "awards", label: "Awards" },
  { key: "debrief", label: "Debrief" },
];

/** Plain words for the shadow phases (the jargon gets one line of meaning). */
const SHADOW_LINES: Record<string, string> = {
  DOMINANT: "The Shadow has established full dominance. Emergency countermeasures required across all domains.",
  HUNTING: "Closing in on your position. Daily consistency will close the gap in two weeks.",
};
const SHADOW_DEFAULT = "Active. Gaining at its daily rate. Your logs are the only countermeasure.";

export default function StatsScreen() {
  const router = useRouter();
  const colors = useColors();
  const params = useLocalSearchParams<{ section?: string }>();
  const initial = TABS.some((t) => t.key === params.section) ? (params.section as Tab) : "overview";
  const [tab, setTab] = useState<Tab>(initial);
  const { user, shadowSelf, logs, quests, tierProgress, achievements, milestones, getShadowPhase, loading, loadError, refresh } = useApp();
  const userId = useGameUserId();

  const ledgerQ = useDeferralsQuery(30);
  const ledger = ledgerQ.data ?? null;

  const perfQ = useQuery({
    queryKey: completionSummaryKey(userId, 14),
    queryFn: () => fetchCompletionSummary(api, 14),
    enabled: !!userId,
  });
  const perfSummary = perfQ.data ?? null;

  const debriefQ = useQuery({ queryKey: debriefKey(userId), queryFn: () => fetchDebriefToday(api), enabled: !!userId });
  const debriefData = debriefQ.data;
  const debrief = debriefData?.available ? debriefData.debrief.text : "";
  const debriefOpensAt =
    debriefData && !debriefData.available
      ? new Date(debriefData.availableAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
      : null;

  const weakestExecutionDomain = useMemo(() => {
    if (!perfSummary || perfSummary.byDomain.length === 0) return null;
    const totals: Record<Domain, { attempts: number; completed: number }> = {
      BODY: { attempts: 0, completed: 0 },
      MIND: { attempts: 0, completed: 0 },
      WEALTH: { attempts: 0, completed: 0 },
      SOCIAL: { attempts: 0, completed: 0 },
      DISCIPLINE: { attempts: 0, completed: 0 },
    };
    for (const row of perfSummary.byDomain) {
      if (!(row.domain in totals)) continue;
      const key = row.domain as Domain;
      totals[key].attempts += row.count;
      if (row.status === "complete") totals[key].completed += row.count;
    }
    const ranked = DOMAINS.map((d) => ({
      domain: d,
      rate: totals[d].attempts > 0 ? totals[d].completed / totals[d].attempts : 1,
      attempts: totals[d].attempts,
    })).filter((x) => x.attempts > 0);
    if (ranked.length === 0) return null;
    ranked.sort((a, b) => a.rate - b.rate);
    return ranked[0]?.domain ?? null;
  }, [perfSummary]);

  /** Daily completion rate (0-1) over the last 14 days with attempts, oldest first. */
  const trend = useMemo(() => {
    if (!perfSummary || perfSummary.daily.length === 0) return [];
    const dayMap = new Map<string, { attempts: number; completed: number }>();
    for (const row of perfSummary.daily) {
      const rec = dayMap.get(row.day) ?? { attempts: 0, completed: 0 };
      rec.attempts += row.count;
      if (row.status === "complete") rec.completed += row.count;
      dayMap.set(row.day, rec);
    }
    return Array.from(dayMap.entries())
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .slice(-14)
      .map(([day, v]) => ({ day, rate: v.attempts > 0 ? v.completed / v.attempts : 0 }));
  }, [perfSummary]);

  if (!user) {
    return <ScreenStatus failed={!loading && !!loadError} message="The System is out of reach. Check your connection." onRetry={() => void refresh()} />;
  }

  const rank = user.rank ?? "E";
  const line = rankLine(rank, tierProgress);
  const showRankUpPrep = shouldShowRankUpPrep({ rank, tierProgress, dayNumber: user.dayNumber });
  const completedQuests = quests.filter((q) => q.status === "complete" && !q.bonus).length;
  const forbiddenLogs = logs.filter((l) => l.forbidden).length;
  const shadowPhase = getShadowPhase();
  const unlockedAchievements = achievements.filter((a) => a.unlockedAt !== null);
  const unlockedMilestones = milestones.filter((m) => m.unlockedAt !== null);

  return (
    <Screen title="Stats" back>
      <Segmented options={TABS} value={tab} onChange={setTab} />

      {tab === "overview" && (
        <>
          <Text style={[type.body, { color: colors.foreground }]}>
            {overviewLine({ day: user.dayNumber, logs: logs.length, quests: completedQuests, forbidden: forbiddenLogs })}
          </Text>

          {line.next && (
            <Section title={`Rank ${rank}`}>
              <ProgressLine value={line.progress} color={showRankUpPrep ? colors.warn : colors.rank[rank as keyof typeof colors.rank] ?? colors.foreground} />
              <Text style={[type.body, { color: colors.foreground }]}>{line.progressLine}</Text>
              {line.promotionLine ? <Text style={[type.meta, { color: colors.mutedForeground }]}>{line.promotionLine}</Text> : null}
              {showRankUpPrep && (
                <ListRow
                  title="Promotion threshold near"
                  subtitle="Rank-up prep missions are on the Quest board."
                  dot={colors.warn}
                  chevron
                  onPress={() => router.push("/(tabs)/quests")}
                />
              )}
            </Section>
          )}

          <Section title="Performance, 14 days">
            {perfQ.isError && !perfSummary ? (
              <>
                <SystemLine tone="error">Performance feed unavailable.</SystemLine>
                <Button label="Retry" variant="tonal" onPress={() => void perfQ.refetch()} loading={perfQ.isFetching} />
              </>
            ) : perfSummary ? (
              <>
                {perfSummary.attempts > 0 ? (
                  <Text style={[type.number, { color: colors.foreground }]} accessibilityLabel={`${perfSummary.completionRate}% complete rate`}>
                    {`${perfSummary.completionRate}% complete`}
                  </Text>
                ) : null}
                <SystemLine>{performanceLine(perfSummary.completed, perfSummary.attempts, 14)}</SystemLine>
                {trend.length >= 2 ? (
                  <View style={s.bars} accessible accessibilityLabel={`Daily completion over ${trend.length} days`}>
                    {trend.map((p) => (
                      <View key={p.day} style={[s.barSlot, { backgroundColor: colors.muted }]}>
                        <View style={[s.bar, { height: `${Math.max(4, p.rate * 100)}%`, backgroundColor: colors.mutedForeground }]} />
                      </View>
                    ))}
                  </View>
                ) : (
                  <SystemLine>The daily trend builds after your second day.</SystemLine>
                )}
                {weakestExecutionDomain && (
                  <ListRow
                    title={`Weakest: ${weakestExecutionDomain}`}
                    subtitle="Lowest completion rate. Open its quests."
                    dot={DOMAIN_COLORS[weakestExecutionDomain]}
                    chevron
                    onPress={() => router.push({ pathname: "/(tabs)/quests", params: { domain: weakestExecutionDomain } })}
                  />
                )}
              </>
            ) : perfQ.isFetching ? (
              <SystemLine>Reading performance.</SystemLine>
            ) : (
              <SystemLine>No performance data yet.</SystemLine>
            )}
          </Section>

          <Section title="Habit calendar, 4 weeks">
            <StreakCalendar logs={logs} weeks={4} />
          </Section>

          {shadowSelf.active && (
            <Section title="Shadow self" trailing={<Text style={[type.label, { color: colors.destructive }]}>{shadowPhase}</Text>}>
              <Text style={[type.number, { color: shadowSelf.gap > 0 ? colors.destructive : colors.success }]}>
                {shadowSelf.gap > 0 ? `${shadowSelf.gap.toFixed(1)} ahead of you` : `${Math.abs(shadowSelf.gap).toFixed(1)} behind you`}
              </Text>
              <Text style={[type.meta, { color: colors.mutedForeground }]}>Gap: how far your Shadow's scores sit above or below yours.</Text>
              <Text style={[type.body, { color: colors.mutedForeground }]}>{SHADOW_LINES[shadowPhase] ?? SHADOW_DEFAULT}</Text>
            </Section>
          )}

          <View>
            <ListRow title="Custom stats" subtitle="Your own numbers. Never part of rank." chevron onPress={() => router.push("/custom")} />
            <ListRow title="Weekly recap" chevron onPress={() => router.push("/recap")} />
          </View>
        </>
      )}

      {tab === "history" && (
        <>
          <HistoryPanel />
          <RankFreezeCard />
        </>
      )}

      {tab === "awards" && (
        <>
          <Section title="Achievements" trailing={<Text style={[type.meta, { color: colors.mutedForeground }]}>{`${unlockedAchievements.length} of ${achievements.length}`}</Text>}>
            <View>
              {achievements.map((a) => {
                const def = ACHIEVEMENT_DEFS[a.id];
                const unlocked = a.unlockedAt !== null;
                return (
                  <View key={a.id} style={[s.award, { borderBottomColor: colors.border }]} accessible accessibilityLabel={`${def.title}, ${unlocked ? "unlocked" : "locked"}. ${def.description}`}>
                    <Feather name={(unlocked ? def.icon : "lock") as keyof typeof Feather.glyphMap} size={20} color={unlocked ? colors.warn : colors.subtle} />
                    <View style={s.flex}>
                      <Text style={[type.body, { color: unlocked ? colors.foreground : colors.mutedForeground }]}>{def.title}</Text>
                      <Text style={[type.meta, { color: colors.subtle }]}>{def.description}</Text>
                    </View>
                    {unlocked && (
                      <Text style={[type.meta, { color: colors.mutedForeground }]}>
                        {new Date(a.unlockedAt!).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                      </Text>
                    )}
                  </View>
                );
              })}
            </View>
          </Section>

          <Section title="Domain milestones" trailing={<Text style={[type.meta, { color: colors.mutedForeground }]}>{`${unlockedMilestones.length} of ${milestones.length}`}</Text>}>
            {DOMAINS.map((domain) => {
              const domColor = DOMAIN_COLORS[domain];
              const got = MILESTONE_TIERS.filter((tier) => {
                const m = milestones.find((ml) => ml.domain === domain && ml.tier === tier);
                return !!m && m.unlockedAt !== null;
              });
              const top = got[got.length - 1];
              return (
                <View key={domain} style={[s.milestoneRow, { borderBottomColor: colors.border }]} accessible accessibilityLabel={`${domain}: ${got.length} of 5 milestones${top ? `, ${MILESTONE_TITLES[domain][top]}` : ""}`}>
                  <View style={[s.dot, { backgroundColor: domColor }]} />
                  <View style={s.flex}>
                    <Text style={[type.body, { color: colors.foreground }]}>{domain}</Text>
                    <Text style={[type.meta, { color: colors.mutedForeground }]}>
                      {top ? MILESTONE_TITLES[domain][top] : `Next: ${MILESTONE_TITLES[domain][60]} at 60`}
                    </Text>
                  </View>
                  <View style={s.pips}>
                    {MILESTONE_TIERS.map((tier) => (
                      <View key={tier} style={[s.pip, { backgroundColor: got.includes(tier) ? domColor : colors.muted }]} />
                    ))}
                  </View>
                </View>
              );
            })}
          </Section>
        </>
      )}

      {tab === "debrief" && (
        <>
          <Section title="Nightly debrief">
            {debrief ? (
              <SystemWindow title="NIGHTLY DEBRIEF">
                <SystemMessage message={debrief} animate />
              </SystemWindow>
            ) : debriefOpensAt ? (
              <SystemLine>{`The debrief opens at ${debriefOpensAt}.`}</SystemLine>
            ) : debriefQ.isError ? (
              <SystemLine tone="error">The System is out of reach.</SystemLine>
            ) : null}
            <Button label={debriefQ.isFetching ? "Checking" : "Check today's debrief"} variant="tonal" loading={debriefQ.isFetching} onPress={() => void debriefQ.refetch()} />
          </Section>

          {/* Deferral ledger: the user's own refusal reasons, newest first. Never shared with rivals or clans. */}
          <Section title={LEDGER_HEADER}>
            {ledger ? (
              <>
                <Text style={[type.body, { color: colors.foreground }]}>
                  {ledger.countThisWeek === 0
                    ? "No deferrals this week."
                    : `You deferred ${ledger.countThisWeek} time${ledger.countThisWeek === 1 ? "" : "s"} this week.`}
                </Text>
                {ledger.items.slice(0, 10).map((item, i) => (
                  <Text key={`${item.localDate}-${i}`} style={[type.meta, { color: colors.mutedForeground }]}>
                    {ledgerLine(item)}
                  </Text>
                ))}
              </>
            ) : ledgerQ.isError ? (
              <SystemLine tone="error">The System is out of reach.</SystemLine>
            ) : (
              <SystemLine>Reading the ledger.</SystemLine>
            )}
          </Section>
        </>
      )}
    </Screen>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1 },
  bars: { flexDirection: "row", alignItems: "flex-end", gap: space.xs, height: 40 },
  barSlot: { flex: 1, height: "100%", justifyContent: "flex-end", borderRadius: 1, overflow: "hidden" },
  bar: { width: "100%" },
  award: { flexDirection: "row", alignItems: "center", gap: space.md, minHeight: 64, paddingVertical: space.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  milestoneRow: { flexDirection: "row", alignItems: "center", gap: space.md, minHeight: 64, borderBottomWidth: StyleSheet.hairlineWidth },
  dot: { width: 8, height: 8, borderRadius: 4 },
  pips: { flexDirection: "row", gap: space.xs },
  pip: { width: 12, height: 4, borderRadius: 2 },
});
