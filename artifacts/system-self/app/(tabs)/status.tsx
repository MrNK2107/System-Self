// Status: who you are. One STATUS window (name, job, title, rank, five domains); everything else is one tap away.
import { router } from "expo-router";
import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { ScreenStatus } from "@/components/ScreenStatus";
import { DomainStatusRow, ProgressLine, StatField } from "@/components/status/parts";
import { domainHref, useStatus } from "@/components/status/useStatus";
import { ListRow } from "@/components/ui/ListRow";
import { RankEmblem } from "@/components/ui/RankEmblem";
import { IconButton, Screen } from "@/components/ui/Screen";
import { SystemWindow } from "@/components/ui/SystemWindow";
import { DOMAIN_COLORS } from "@/constants/domains";
import { space, type } from "@/constants/type";
import { useColors } from "@/hooks/useColors";
import { rankLine } from "@/lib/status/status";

/** Score direction over the last seven days (server trajectory). */
const TRAJECTORY_LABEL = { up: "Climbing", stable: "Stable", down: "Falling" } as const;

export default function StatusTab() {
  const colors = useColors();
  const { user, domainScores, tierProgress, trajectory, achievements, job, title, changes, loading, loadError, refresh, historyQ } = useStatus();
  const [refreshing, setRefreshing] = React.useState(false);

  if (!user) {
    return <ScreenStatus failed={!loading && !!loadError} message="The System is out of reach. Check your connection." onRetry={() => void refresh()} />;
  }

  const rank = user.rank;
  const line = rankLine(rank, tierProgress);
  const rankTone = colors.rank[rank] ?? colors.primary;
  const unlocked = achievements.filter((a) => a.unlockedAt !== null).length;

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([refresh(), historyQ.refetch()]);
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <Screen
      title="Status"
      tab
      refreshing={refreshing}
      onRefresh={() => void onRefresh()}
      action={<IconButton icon="settings" label="Settings" onPress={() => router.push("/settings")} />}
    >
      <SystemWindow title="STATUS" style={s.window}>
        <View style={s.fields}>
          <StatField label="NAME" value={user.username} />
          {job ? <StatField label="JOB" value={job} /> : null}
          {title ? <StatField label="TITLE" value={title} /> : null}
        </View>

        <View style={s.hero} accessible accessibilityLabel={`Rank ${rank}. ${line.progressLine}. ${line.promotionLine ?? ""} Trajectory: ${TRAJECTORY_LABEL[trajectory]}.`}>
          <RankEmblem rank={rank} size={160} />
          <Text style={[type.title, { color: colors.foreground }]}>{`RANK ${rank}`}</Text>
          <ProgressLine value={line.progress} color={rankTone} width={160} />
          <Text style={[type.meta, { color: colors.mutedForeground }]}>{line.progressLine}</Text>
          {line.promotionLine ? <Text style={[type.meta, s.center, { color: colors.subtle }]}>{line.promotionLine}</Text> : null}
          <Text style={[type.meta, { color: colors.mutedForeground }]}>
            {"Trajectory: "}
            <Text style={{ color: trajectory === "up" ? colors.success : trajectory === "down" ? colors.destructive : colors.foreground }}>
              {TRAJECTORY_LABEL[trajectory]}
            </Text>
          </Text>
        </View>

        <View>
          {domainScores.map((ds) => (
            <DomainStatusRow
              key={ds.domain}
              name={ds.domain}
              color={DOMAIN_COLORS[ds.domain]}
              score={ds.score}
              change={changes[ds.domain] ?? null}
              onPress={() => router.push(domainHref(ds.domain))}
            />
          ))}
        </View>
      </SystemWindow>

      <View>
        <ListRow title="Log history" subtitle="Every entry, by day" chevron onPress={() => router.push("/history")} />
        <ListRow
          title="Achievements"
          subtitle={`${unlocked} of ${achievements.length} unlocked`}
          chevron
          onPress={() => router.push({ pathname: "/stats", params: { section: "awards" } })}
        />
        <ListRow title="Weekly recap" chevron onPress={() => router.push("/recap")} />
        <ListRow title="Full stats" subtitle="History, performance, shadow" chevron onPress={() => router.push("/stats")} />
      </View>
    </Screen>
  );
}

const s = StyleSheet.create({
  window: { paddingBottom: space.sm },
  fields: { gap: space.xs },
  hero: { alignItems: "center", gap: space.sm, paddingTop: space.md, paddingBottom: space.lg },
  center: { textAlign: "center" },
});
