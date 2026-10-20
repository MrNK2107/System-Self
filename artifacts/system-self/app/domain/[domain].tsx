// One domain's detail: score, week change, streak, its score history, milestones, recent logs, and where its
// deeper tools live (BODY -> Gym, WEALTH -> Finance).
import { router, useLocalSearchParams, type Href } from "expo-router";
import React, { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";

import { HistoryPanel } from "@/components/HistoryPanel";
import { ScreenStatus } from "@/components/ScreenStatus";
import { LogRow } from "@/components/status/LogRow";
import { ChangeText, Figure, Section, SystemLine } from "@/components/status/parts";
import { useStatus } from "@/components/status/useStatus";
import { Button } from "@/components/ui/Button";
import { ListRow } from "@/components/ui/ListRow";
import { Screen } from "@/components/ui/Screen";
import { SystemWindow } from "@/components/ui/SystemWindow";
import { ALL_DOMAINS, DOMAIN_COLORS } from "@/constants/domains";
import { space, type } from "@/constants/type";
import { MILESTONE_TITLES, getStreakMultiplier, type Domain, type MilestoneTier } from "@/context/AppContext";
import { useColors } from "@/hooks/useColors";

const MILESTONE_TIERS: MilestoneTier[] = [60, 70, 80, 90, 100];
const RECENT = 10;

/** Where a domain's own tools live. */
const DOMAIN_LINKS: Partial<Record<Domain, { title: string; subtitle: string; href: Href }>> = {
  BODY: { title: "Gym", subtitle: "Sessions, lifts and the home path", href: "/gym" },
  WEALTH: { title: "Finance", subtitle: "Savings rate, budgets, goals. Private.", href: "/finance" },
};

export default function DomainDetail() {
  const colors = useColors();
  const params = useLocalSearchParams<{ domain?: string }>();
  const raw = String(params.domain ?? "").toUpperCase();
  const domain = (ALL_DOMAINS as readonly string[]).includes(raw) ? (raw as Domain) : null;
  const { user, domainScores, logs, milestones, changes, loading, loadError, refresh } = useStatus();

  const recent = useMemo(
    () => (domain ? logs.filter((l) => l.domain === domain).sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp)) : []),
    [logs, domain],
  );

  if (!domain) {
    return (
      <Screen title="Domain" back>
        <SystemLine>Unknown domain.</SystemLine>
        <Button label="Back to Status" onPress={() => router.replace("/(tabs)/status")} />
      </Screen>
    );
  }
  if (!user) {
    return <ScreenStatus failed={!loading && !!loadError} message="The System is out of reach. Check your connection." onRetry={() => void refresh()} />;
  }

  const ds = domainScores.find((d) => d.domain === domain);
  const score = ds?.score ?? 0;
  const streak = ds?.streak ?? 0;
  const color = DOMAIN_COLORS[domain];
  const link = DOMAIN_LINKS[domain];
  const unlockedTop = milestones.filter((m) => m.domain === domain && m.unlockedAt !== null).sort((a, b) => b.tier - a.tier)[0];
  const name = domain.charAt(0) + domain.slice(1).toLowerCase();

  return (
    <Screen title={name} back>
      <SystemWindow title={domain} frameColor={color}>
        <View style={s.hero} accessible accessibilityLabel={`${domain} score ${score.toFixed(1)}`}>
          <Text style={[type.display, { color: colors.foreground }]}>{score.toFixed(1)}</Text>
          <View style={s.heroMeta}>
            <ChangeText value={changes[domain] ?? null} />
            <Text style={[type.meta, { color: colors.mutedForeground }]}>this week</Text>
          </View>
        </View>
        <View style={s.figures}>
          <Figure label="STREAK" value={`${streak}d`} />
          <Figure label="MULTIPLIER" value={`x${getStreakMultiplier(streak).toFixed(1)}`} />
          <Figure label="LOGS" value={recent.length} />
        </View>
        {unlockedTop ? (
          <Text style={[type.meta, s.center, { color: colors.mutedForeground }]}>{`Title earned: ${unlockedTop.title}`}</Text>
        ) : null}
      </SystemWindow>

      {link ? <ListRow title={link.title} subtitle={link.subtitle} dot={color} chevron onPress={() => router.push(link.href)} /> : null}

      <HistoryPanel domain={domain} />

      <Section title="Milestones">
        {MILESTONE_TIERS.map((tier) => {
          const m = milestones.find((x) => x.domain === domain && x.tier === tier);
          const got = !!m && m.unlockedAt !== null;
          return (
            <View key={tier} style={[s.milestone, { borderBottomColor: colors.border }]} accessible accessibilityLabel={`${tier}: ${MILESTONE_TITLES[domain][tier]}, ${got ? "earned" : "locked"}`}>
              <Text style={[type.number, s.tier, { color: got ? color : colors.subtle }]}>{tier}</Text>
              <Text style={[type.body, s.flex, { color: got ? colors.foreground : colors.subtle }]}>{MILESTONE_TITLES[domain][tier]}</Text>
              {got ? (
                <Text style={[type.meta, { color: colors.mutedForeground }]}>
                  {new Date(m!.unlockedAt!).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                </Text>
              ) : null}
            </View>
          );
        })}
      </Section>

      <Section title="Recent logs">
        {recent.length === 0 ? (
          <SystemLine>{`No ${domain} logs yet. Log one from the Log tab.`}</SystemLine>
        ) : (
          <View>
            {recent.slice(0, RECENT).map((l) => (
              <LogRow key={l.id} entry={l} showDomain={false} showDate />
            ))}
          </View>
        )}
        {recent.length > RECENT ? <ListRow title="All log history" chevron onPress={() => router.push("/history")} /> : null}
      </Section>
    </Screen>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1 },
  center: { textAlign: "center" },
  hero: { alignItems: "center", gap: space.xs, paddingVertical: space.sm },
  heroMeta: { flexDirection: "row", alignItems: "center", gap: space.xs },
  figures: { flexDirection: "row", paddingVertical: space.sm },
  milestone: { flexDirection: "row", alignItems: "center", gap: space.md, minHeight: 48, borderBottomWidth: StyleSheet.hairlineWidth },
  tier: { width: 40 },
});
