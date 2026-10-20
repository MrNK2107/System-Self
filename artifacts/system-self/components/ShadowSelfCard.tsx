import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { type Domain, type ShadowSelf } from "@/context/AppContext";
import { ALL_DOMAINS as DOMAINS, DOMAIN_COLORS } from "@/constants/domains";
import { space, type } from "@/constants/type";
import { shadowTallyLine } from "@/lib/game/adherence";

interface Props {
  shadow: ShadowSelf;
  shadowScores: Record<Domain, string | number>;
  shadowRank: string;
  userScores: Record<Domain, number>;
  /** Sessions the Shadow took from refused BODY quests, newest first. Narrative only: no score effect. */
  takeovers?: { questTitle: string; localDate: string }[];
}

/** The running "SHADOW completed: ..." tally. Also shown as a dormant note while the Shadow is inactive. */
export function ShadowTakeoverTally({
  takeovers,
  dormant = false,
}: {
  takeovers: { questTitle: string; localDate: string }[];
  dormant?: boolean;
}) {
  const colors = useColors();
  if (takeovers.length === 0) return null;
  return (
    <View style={styles.tally}>
      <Text style={[type.bodyStrong, { color: dormant ? colors.mutedForeground : colors.foreground }]}>
        {dormant ? "Dormant shadow" : "Sessions the shadow took"} · {takeovers.length}
      </Text>
      {takeovers.slice(0, 5).map((t, i) => (
        <Text key={`${t.localDate}-${i}`} style={[type.meta, { color: colors.mutedForeground }]}>
          {shadowTallyLine(t.questTitle)}
        </Text>
      ))}
    </View>
  );
}

export function ShadowSelfCard({ shadow, shadowScores, shadowRank, userScores, takeovers = [] }: Props) {
  const colors = useColors();

  const totalGap =
    DOMAINS.reduce((sum, d) => sum + ((Number(shadowScores[d]) || 0) - (userScores[d] ?? 0)), 0) / DOMAINS.length;
  const isAhead = totalGap > 0;
  const domainsLosing = DOMAINS.filter((d) => (Number(shadowScores[d]) || 0) > (userScores[d] ?? 0));
  const tone = isAhead ? colors.destructive : colors.success;
  const dailyGain = Object.values(shadow.dailyGainRate).reduce((a, b) => a + b, 0);

  return (
    <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.card }]}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={[type.title, { color: colors.foreground }]}>{shadow.codename}</Text>
          <Text style={[type.meta, { color: colors.mutedForeground }]}>Your shadow: the self that never skips.</Text>
        </View>
        <View style={[styles.rankBadge, { borderColor: colors.destructive }]} accessibilityLabel={`Shadow rank ${shadowRank}`}>
          <Text style={[type.number, { color: colors.destructive }]}>{shadowRank}</Text>
        </View>
      </View>

      <Text style={[type.body, { color: tone }]} accessibilityLiveRegion="polite">
        {isAhead
          ? `Ahead of you by ${Math.abs(totalGap).toFixed(1)} pts on average. ${domainsLosing.length} domain${domainsLosing.length !== 1 ? "s" : ""} behind.`
          : `You lead your shadow by ${Math.abs(totalGap).toFixed(1)} pts on average. Hold it.`}
      </Text>

      <View style={styles.domains}>
        {DOMAINS.map((d) => {
          const shadowScore = Number(shadowScores[d]) || 0;
          const userScore = userScores[d] ?? 0;
          const diff = shadowScore - userScore;
          const losing = diff > 0;
          const color = DOMAIN_COLORS[d];
          return (
            <View
              key={d}
              style={styles.domainRow}
              accessibilityLabel={`${d}: you ${userScore.toFixed(1)}, shadow ${shadowScore.toFixed(1)}`}
            >
              <Text style={[type.label, styles.domainLabel, { color: colors.mutedForeground }]}>{d}</Text>
              <View style={[styles.track, { backgroundColor: colors.muted }]}>
                <View style={[styles.fill, { width: `${Math.min(100, userScore)}%`, backgroundColor: color }]} />
                <View style={[styles.marker, { left: `${Math.min(100, shadowScore)}%`, backgroundColor: colors.destructive }]} />
              </View>
              <Text style={[type.meta, styles.diff, { color: losing ? colors.destructive : colors.success }]}>
                {losing ? `−${diff.toFixed(1)}` : `+${Math.abs(diff).toFixed(1)}`}
              </Text>
            </View>
          );
        })}
      </View>

      <ShadowTakeoverTally takeovers={takeovers} />

      <Text style={[type.meta, { color: colors.subtle }]}>
        The shadow gains {dailyGain.toFixed(1)} pts a day across all domains. Log to close the gap. The red tick marks its score.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 4, padding: space.md, gap: space.md },
  header: { flexDirection: "row", alignItems: "center", gap: space.md },
  headerText: { flex: 1, gap: 2 },
  rankBadge: { width: 48, height: 48, borderWidth: 1, borderRadius: 4, alignItems: "center", justifyContent: "center" },
  domains: { gap: space.sm + 4 },
  domainRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
  domainLabel: { width: 96 },
  track: { flex: 1, height: 6, borderRadius: 3, position: "relative" },
  fill: { position: "absolute", left: 0, top: 0, height: "100%", borderRadius: 3 },
  marker: { position: "absolute", top: -3, width: 2, height: 12, borderRadius: 1, marginLeft: -1 },
  diff: { width: 44, textAlign: "right" },
  tally: { gap: space.xs },
});
