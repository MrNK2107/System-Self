import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Animated,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useApp, type Domain, type Rank, type Rival, type Trajectory } from "@/context/AppContext";
import { ShadowSelfCard } from "@/components/ShadowSelfCard";
import { RankBadge } from "@/components/RankBadge";

const DRIFT_KEY = "@system_self:rivals_last_drift";
const DOMAINS: Domain[] = ["BODY", "MIND", "WEALTH", "DISCIPLINE"];
const DOMAIN_COLORS: Record<Domain, string> = {
  BODY: "#E05555",
  MIND: "#3A7BD5",
  WEALTH: "#4B8B6F",
  DISCIPLINE: "#C4873A",
};
const DOMAIN_ICONS: Record<Domain, string> = {
  BODY: "◈",
  MIND: "◉",
  WEALTH: "◆",
  DISCIPLINE: "▲",
};

// --- score helpers ----------------------------------------------------------

function computeRivalComposite(rival: Rival): number {
  const { bodyScore: b, mindScore: m, wealthScore: w, disciplineScore: d } = rival;
  const mult = d >= 75 ? 1.1 : d < 50 ? 0.85 : 1.0;
  return (b * 0.2 + m * 0.2 + w * 0.15 + d * 0.45) * mult;
}

function computeUserComposite(scores: Record<Domain, number>): number {
  const { BODY: b, MIND: m, WEALTH: w, DISCIPLINE: d } = scores;
  const mult = d >= 75 ? 1.1 : d < 50 ? 0.85 : 1.0;
  return (b * 0.2 + m * 0.2 + w * 0.15 + d * 0.45) * mult;
}

// --- types ------------------------------------------------------------------

interface LeaderEntry {
  id: string;
  codename: string;
  composite: number;
  rank: Rank;
  trajectory: Trajectory;
  isUser: boolean;
  isShadow: boolean;
  shadowActive: boolean;
  bodyScore: number;
  mindScore: number;
  wealthScore: number;
  disciplineScore: number;
}

type StatusLabel = "THREATENING" | "CLOSING" | "AHEAD" | "BEHIND" | "SHADOW";

function getStatus(entry: LeaderEntry, userComposite: number): StatusLabel | null {
  if (entry.isUser) return null;
  if (entry.isShadow) return "SHADOW";
  const delta = entry.composite - userComposite;
  if (delta > 0 && entry.trajectory === "up") return "THREATENING";
  if (delta > 0) return "AHEAD";
  if (delta > -8 && entry.trajectory === "up") return "CLOSING";
  return "BEHIND";
}

// --- Leaderboard row --------------------------------------------------------

function LeaderRow({
  entry,
  position,
  userComposite,
  index,
}: {
  entry: LeaderEntry;
  position: number;
  userComposite: number;
  index: number;
}) {
  const colors = useColors();
  const rowAnim = useRef(new Animated.Value(0)).current;
  const status = getStatus(entry, userComposite);
  const delta = entry.composite - userComposite;
  const isUser = entry.isUser;
  const isFirst = position === 1;

  useEffect(() => {
    const t = setTimeout(() => {
      Animated.timing(rowAnim, { toValue: 1, duration: 280, useNativeDriver: false }).start();
    }, index * 70);
    return () => clearTimeout(t);
  }, []);

  const posColor = isFirst ? "#D4B483" : isUser ? colors.primary : colors.mutedForeground;
  const borderColor = isUser
    ? colors.primary + "60"
    : entry.isShadow
    ? "#E0555550"
    : colors.border;
  const bgColor = isUser
    ? colors.primary + "08"
    : entry.isShadow
    ? "#E0555506"
    : "transparent";

  const statusColorMap: Record<StatusLabel, string> = {
    THREATENING: "#E05555",
    CLOSING: "#C4873A",
    AHEAD: colors.mutedForeground,
    BEHIND: "#4B8B6F",
    SHADOW: "#E05555",
  };

  const trajectoryIcon =
    entry.trajectory === "up" ? "↑" :
    entry.trajectory === "down" ? "↓" : "→";
  const trajectoryColor =
    entry.trajectory === "up" ? (delta > 0 ? "#E05555" : "#C4873A") :
    entry.trajectory === "down" ? "#4B8B6F" :
    colors.mutedForeground;

  return (
    <Animated.View style={[
      leaderStyles.row,
      {
        opacity: rowAnim,
        borderColor,
        backgroundColor: bgColor,
        transform: [{ translateX: rowAnim.interpolate({ inputRange: [0, 1], outputRange: [-8, 0] }) }],
      },
    ]}>
      <Text style={[leaderStyles.pos, { color: posColor }]}>
        {isFirst ? "①" : `#${position}`}
      </Text>

      <View style={leaderStyles.main}>
        <View style={leaderStyles.nameRow}>
          <Text
            style={[leaderStyles.codename, { color: isUser ? colors.primary : colors.foreground }]}
            numberOfLines={1}
          >
            {entry.codename}
          </Text>
          {isUser && (
            <View style={[leaderStyles.youTag, { borderColor: colors.primary + "60" }]}>
              <Text style={[leaderStyles.youText, { color: colors.primary }]}>YOU</Text>
            </View>
          )}
        </View>
        <View style={leaderStyles.metaRow}>
          <Text style={[leaderStyles.composite, { color: colors.foreground }]}>
            {entry.composite.toFixed(1)}
          </Text>
          <Text style={[leaderStyles.trajectory, { color: trajectoryColor }]}>
            {trajectoryIcon}
          </Text>
          {!entry.isUser && (
            <Text style={[leaderStyles.delta, { color: delta > 0 ? "#E05555" : "#4B8B6F" }]}>
              {delta > 0 ? `+${delta.toFixed(1)}` : delta.toFixed(1)}
            </Text>
          )}
        </View>
      </View>

      <View style={leaderStyles.right}>
        <RankBadge rank={entry.rank} size="sm" />
        {status && (
          <View style={[leaderStyles.statusBadge, { borderColor: statusColorMap[status] + "50" }]}>
            <Text style={[leaderStyles.statusText, { color: statusColorMap[status] }]}>
              {status}
            </Text>
          </View>
        )}
      </View>
    </Animated.View>
  );
}

const leaderStyles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderRadius: 4,
  },
  pos: { width: 28, fontSize: 13, fontWeight: "800" as const, textAlign: "center" },
  main: { flex: 1, gap: 3 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  codename: { fontSize: 11, fontWeight: "700" as const, letterSpacing: 0.3, flex: 1 },
  youTag: { borderWidth: 1, borderRadius: 2, paddingHorizontal: 5, paddingVertical: 1 },
  youText: { fontSize: 7, fontWeight: "800" as const, letterSpacing: 2 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  composite: { fontSize: 13, fontWeight: "800" as const, letterSpacing: 0.5 },
  trajectory: { fontSize: 14, fontWeight: "700" as const },
  delta: { fontSize: 10, fontWeight: "700" as const, letterSpacing: 0.3 },
  right: { alignItems: "flex-end", gap: 4 },
  statusBadge: { borderWidth: 1, borderRadius: 2, paddingHorizontal: 5, paddingVertical: 2 },
  statusText: { fontSize: 7, fontWeight: "800" as const, letterSpacing: 1.5 },
});

// --- Domain threat matrix --------------------------------------------------

function DomainThreatMatrix({
  entries,
  userScores,
}: {
  entries: LeaderEntry[];
  userScores: Record<Domain, number>;
}) {
  const colors = useColors();
  const rivals = entries.filter(e => !e.isUser && !e.isShadow);
  if (rivals.length === 0) return null;

  return (
    <View style={[matrixStyles.card, { borderColor: colors.border, backgroundColor: colors.card }]}>
      <View style={matrixStyles.header}>
        <Text style={[matrixStyles.title, { color: colors.mutedForeground }]}>DOMAIN EXPOSURE</Text>
        <Text style={[matrixStyles.sub, { color: colors.mutedForeground }]}>
          red = rival leads · green = you lead
        </Text>
      </View>

      <View style={matrixStyles.tableHeader}>
        <View style={matrixStyles.nameCol} />
        {DOMAINS.map(d => (
          <View key={d} style={matrixStyles.domainCol}>
            <Text style={[matrixStyles.domainIcon, { color: DOMAIN_COLORS[d] }]}>
              {DOMAIN_ICONS[d]}
            </Text>
          </View>
        ))}
      </View>

      {rivals.map(entry => (
        <View key={entry.id} style={matrixStyles.tableRow}>
          <Text style={[matrixStyles.rivalName, { color: colors.mutedForeground }]} numberOfLines={1}>
            {entry.codename.split(" // ")[1] ?? entry.codename}
          </Text>
          {DOMAINS.map(d => {
            const rivalScore =
              d === "BODY" ? entry.bodyScore :
              d === "MIND" ? entry.mindScore :
              d === "WEALTH" ? entry.wealthScore :
              entry.disciplineScore;
            const diff = rivalScore - userScores[d];
            const ahead = diff > 0;
            const intensity = Math.min(1, Math.abs(diff) / 20);
            return (
              <View key={d} style={[
                matrixStyles.cell,
                {
                  backgroundColor: ahead
                    ? `rgba(224,85,85,${(0.08 + intensity * 0.25).toFixed(2)})`
                    : `rgba(75,139,111,${(0.06 + intensity * 0.2).toFixed(2)})`,
                  borderColor: ahead ? "#E0555330" : "#4B8B6F20",
                },
              ]}>
                <Text style={[matrixStyles.cellText, { color: ahead ? "#E05555" : "#4B8B6F" }]}>
                  {diff > 0 ? `+${diff.toFixed(0)}` : diff.toFixed(0)}
                </Text>
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const matrixStyles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 6, padding: 14, gap: 10 },
  header: { gap: 3 },
  title: { fontSize: 9, letterSpacing: 3, fontWeight: "700" as const },
  sub: { fontSize: 8, letterSpacing: 1 },
  tableHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingBottom: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#2A2D38",
  },
  nameCol: { flex: 1 },
  domainCol: { width: 46, alignItems: "center" },
  domainIcon: { fontSize: 12 },
  tableRow: { flexDirection: "row", alignItems: "center" },
  rivalName: { flex: 1, fontSize: 9, letterSpacing: 1, fontWeight: "600" as const },
  cell: {
    width: 46, height: 26,
    alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderRadius: 2, marginHorizontal: 1,
  },
  cellText: { fontSize: 9, fontWeight: "700" as const, letterSpacing: 0.3 },
});

// --- Rank position card ----------------------------------------------------

function RankPositionCard({
  position, total, composite, rank, surpassing, losingTo,
}: {
  position: number;
  total: number;
  composite: number;
  rank: Rank;
  surpassing: number;
  losingTo: number;
}) {
  const colors = useColors();

  const posLabel =
    position === 1 ? "LEADING" :
    position === total ? "LAST PLACE" :
    `#${position} OF ${total}`;

  const posColor =
    position === 1 ? "#D4B483" :
    position <= Math.ceil(total / 2) ? colors.primary :
    "#E05555";

  return (
    <View style={[posStyles.card, { borderColor: colors.border, backgroundColor: colors.card }]}>
      <View style={posStyles.top}>
        <View style={posStyles.left}>
          <Text style={[posStyles.posLabel, { color: posColor }]}>{posLabel}</Text>
          <Text style={[posStyles.compositeNum, { color: colors.foreground }]}>
            {composite.toFixed(1)}
          </Text>
          <Text style={[posStyles.compLabel, { color: colors.mutedForeground }]}>COMPOSITE SCORE</Text>
        </View>
        <RankBadge rank={rank} size="md" showLabel />
      </View>

      <View style={[posStyles.divider, { backgroundColor: colors.border }]} />

      <View style={posStyles.statsRow}>
        <View style={posStyles.statItem}>
          <Text style={[posStyles.statNum, { color: "#4B8B6F" }]}>{surpassing}</Text>
          <Text style={[posStyles.statLabel, { color: colors.mutedForeground }]}>SURPASSING</Text>
        </View>
        <View style={[posStyles.statDivider, { backgroundColor: colors.border }]} />
        <View style={posStyles.statItem}>
          <Text style={[posStyles.statNum, { color: losingTo > 0 ? "#E05555" : colors.mutedForeground }]}>
            {losingTo}
          </Text>
          <Text style={[posStyles.statLabel, { color: colors.mutedForeground }]}>LOSING TO</Text>
        </View>
        <View style={[posStyles.statDivider, { backgroundColor: colors.border }]} />
        <View style={posStyles.statItem}>
          <Text style={[posStyles.statNum, { color: colors.foreground }]}>{total}</Text>
          <Text style={[posStyles.statLabel, { color: colors.mutedForeground }]}>TOTAL ENTITIES</Text>
        </View>
      </View>
    </View>
  );
}

const posStyles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 6, padding: 16, gap: 14 },
  top: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  left: { gap: 3 },
  posLabel: { fontSize: 9, fontWeight: "800" as const, letterSpacing: 4 },
  compositeNum: { fontSize: 40, fontWeight: "800" as const, letterSpacing: -1, lineHeight: 46 },
  compLabel: { fontSize: 8, letterSpacing: 2, fontWeight: "600" as const },
  divider: { height: StyleSheet.hairlineWidth },
  statsRow: { flexDirection: "row", alignItems: "center" },
  statItem: { flex: 1, alignItems: "center", gap: 4 },
  statNum: { fontSize: 20, fontWeight: "800" as const },
  statLabel: { fontSize: 7, letterSpacing: 2, fontWeight: "600" as const, textAlign: "center" },
  statDivider: { width: StyleSheet.hairlineWidth, height: 32 },
});

// --- Rival detail card ------------------------------------------------------

function RivalDetailCard({
  rival, userScores, userComposite,
}: {
  rival: Rival;
  userScores: Record<Domain, number>;
  userComposite: number;
}) {
  const colors = useColors();
  const rivalComposite = computeRivalComposite(rival);
  const delta = rivalComposite - userComposite;
  const isAhead = delta > 0;

  const rivalDomainMap: Record<Domain, number> = {
    BODY: rival.bodyScore,
    MIND: rival.mindScore,
    WEALTH: rival.wealthScore,
    DISCIPLINE: rival.disciplineScore,
  };

  const trajectoryIcon = rival.trajectory === "up" ? "↑" : rival.trajectory === "down" ? "↓" : "→";
  const trajectoryColor =
    rival.trajectory === "up" ? (isAhead ? "#E05555" : "#C4873A") :
    rival.trajectory === "down" ? "#4B8B6F" :
    colors.mutedForeground;

  return (
    <View style={[detailStyles.card, { borderColor: colors.border, backgroundColor: colors.card }]}>
      <View style={detailStyles.header}>
        <View style={detailStyles.headerLeft}>
          <Text style={[detailStyles.codename, { color: colors.foreground }]}>{rival.codename}</Text>
          {rival.shadowActive && (
            <View style={[detailStyles.shadowTag, { borderColor: "#E0555550" }]}>
              <Text style={[detailStyles.shadowTagText, { color: "#E05555" }]}>SHADOW ACTIVE</Text>
            </View>
          )}
        </View>
        <View style={detailStyles.headerRight}>
          <Text style={[detailStyles.traj, { color: trajectoryColor }]}>{trajectoryIcon}</Text>
          <RankBadge rank={rival.rank} size="sm" />
        </View>
      </View>

      <View style={[detailStyles.compositeRow, {
        borderColor: isAhead ? "#E0555330" : "#4B8B6F30",
        backgroundColor: isAhead ? "#E0555508" : "#4B8B6F08",
      }]}>
        <Text style={[detailStyles.compositeLabel, { color: colors.mutedForeground }]}>COMPOSITE</Text>
        <Text style={[detailStyles.compositeVal, { color: colors.foreground }]}>
          {rivalComposite.toFixed(1)}
        </Text>
        <Text style={[detailStyles.compositeDelta, { color: isAhead ? "#E05555" : "#4B8B6F" }]}>
          {delta > 0 ? `+${delta.toFixed(1)}` : delta.toFixed(1)}
        </Text>
      </View>

      <View style={detailStyles.domains}>
        {DOMAINS.map(d => {
          const rivalScore = rivalDomainMap[d];
          const userScore = userScores[d];
          const diff = rivalScore - userScore;
          const domColor = DOMAIN_COLORS[d];
          const rivalAhead = diff > 0;
          return (
            <View key={d} style={detailStyles.domainRow}>
              <Text style={[detailStyles.domainLabel, { color: colors.mutedForeground }]}>{d}</Text>
              <View style={detailStyles.trackWrap}>
                <View style={[detailStyles.track, { backgroundColor: colors.muted }]}>
                  <View style={[detailStyles.rivalFill, {
                    width: `${Math.min(100, rivalScore)}%` as `${number}%`,
                    backgroundColor: domColor + "50",
                  }]} />
                  <View style={[detailStyles.userMarker, {
                    left: `${Math.min(100, userScore)}%` as `${number}%`,
                    backgroundColor: colors.primary,
                  }]} />
                </View>
              </View>
              <View style={detailStyles.scoreWrap}>
                <Text style={[detailStyles.rivalScore, { color: colors.foreground }]}>
                  {rivalScore.toFixed(1)}
                </Text>
                <Text style={[detailStyles.diffText, { color: rivalAhead ? "#E05555" : "#4B8B6F" }]}>
                  {diff > 0 ? `+${diff.toFixed(1)}` : diff.toFixed(1)}
                </Text>
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const detailStyles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 6, padding: 16, gap: 12 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  headerLeft: { gap: 5, flex: 1 },
  codename: { fontSize: 13, fontWeight: "700" as const, letterSpacing: 0.3 },
  shadowTag: { borderWidth: 1, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 3, alignSelf: "flex-start" },
  shadowTagText: { fontSize: 7, fontWeight: "800" as const, letterSpacing: 2 },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  traj: { fontSize: 18, fontWeight: "700" as const },
  compositeRow: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderRadius: 4,
  },
  compositeLabel: { fontSize: 8, letterSpacing: 2, fontWeight: "700" as const, flex: 1 },
  compositeVal: { fontSize: 16, fontWeight: "800" as const },
  compositeDelta: { fontSize: 12, fontWeight: "700" as const, width: 48, textAlign: "right" },
  domains: { gap: 8 },
  domainRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  domainLabel: { width: 68, fontSize: 8, fontWeight: "700" as const, letterSpacing: 2, textAlign: "right" },
  trackWrap: { flex: 1 },
  track: { height: 4, borderRadius: 2, overflow: "visible", position: "relative" },
  rivalFill: { position: "absolute", left: 0, top: 0, height: "100%", borderRadius: 2 },
  userMarker: { position: "absolute", top: -2, width: 2, height: 8, borderRadius: 1, marginLeft: -1 },
  scoreWrap: { width: 72, flexDirection: "row", justifyContent: "flex-end", alignItems: "center", gap: 5 },
  rivalScore: { fontSize: 12, fontWeight: "700" as const },
  diffText: { fontSize: 10, fontWeight: "700" as const },
});

// --- Main screen ------------------------------------------------------------

export default function RivalsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const {
    rivals, domainScores, shadowSelf, user,
    getShadowScores, getShadowRank, getHiddenScore, computeRank,
    updateRivals,
  } = useApp();

  const [refreshing, setRefreshing] = useState(false);
  const pulseAnim = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1, duration: 1200, useNativeDriver: false }),
        Animated.timing(pulseAnim, { toValue: 0.4, duration: 1200, useNativeDriver: false }),
      ])
    ).start();
  }, []);

  const applyDrift = useCallback(async (force = false) => {
    const today = new Date().toISOString().split("T")[0]!;
    if (!force) {
      const last = await AsyncStorage.getItem(DRIFT_KEY);
      if (last === today) return;
    }
    const drifted: Rival[] = rivals.map(rival => {
      const baseDrift =
        rival.trajectory === "up" ? 0.35 + Math.random() * 0.45 :
        rival.trajectory === "down" ? -(0.25 + Math.random() * 0.35) :
        (Math.random() - 0.5) * 0.18;
      const clamp = (v: number) => Math.min(99, Math.max(1, v));
      return {
        ...rival,
        bodyScore: clamp(rival.bodyScore + baseDrift * (0.4 + Math.random() * 0.6)),
        mindScore: clamp(rival.mindScore + baseDrift * (0.4 + Math.random() * 0.6)),
        wealthScore: clamp(rival.wealthScore + baseDrift * (0.4 + Math.random() * 0.6)),
        disciplineScore: clamp(rival.disciplineScore + baseDrift * (0.4 + Math.random() * 0.6)),
      };
    });
    await updateRivals(drifted);
    await AsyncStorage.setItem(DRIFT_KEY, today);
  }, [rivals, updateRivals]);

  useEffect(() => {
    if (rivals.length > 0) applyDrift();
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await applyDrift(true);
    setRefreshing(false);
  };

  const userScores: Record<Domain, number> = {
    BODY: domainScores.find(s => s.domain === "BODY")?.score ?? 50,
    MIND: domainScores.find(s => s.domain === "MIND")?.score ?? 50,
    WEALTH: domainScores.find(s => s.domain === "WEALTH")?.score ?? 50,
    DISCIPLINE: domainScores.find(s => s.domain === "DISCIPLINE")?.score ?? 50,
  };

  const shadowScores = getShadowScores();
  const shadowRank = getShadowRank();
  const hiddenScore = getHiddenScore();
  const userRank = user?.rank ?? computeRank(hiddenScore);
  const userComposite = computeUserComposite(userScores);

  const shadowComposite = shadowSelf.active
    ? computeUserComposite({
        BODY: shadowScores.BODY,
        MIND: shadowScores.MIND,
        WEALTH: shadowScores.WEALTH,
        DISCIPLINE: shadowScores.DISCIPLINE,
      })
    : 0;

  const entries: LeaderEntry[] = [
    {
      id: "user",
      codename: user?.username ?? "YOU",
      composite: userComposite,
      rank: userRank,
      trajectory: userComposite > 55 ? "up" : userComposite < 45 ? "down" : "stable",
      isUser: true,
      isShadow: false,
      shadowActive: false,
      bodyScore: userScores.BODY,
      mindScore: userScores.MIND,
      wealthScore: userScores.WEALTH,
      disciplineScore: userScores.DISCIPLINE,
    },
    ...(shadowSelf.active ? [{
      id: "shadow",
      codename: shadowSelf.codename,
      composite: shadowComposite,
      rank: shadowRank,
      trajectory: "up" as Trajectory,
      isUser: false,
      isShadow: true,
      shadowActive: false,
      bodyScore: shadowScores.BODY,
      mindScore: shadowScores.MIND,
      wealthScore: shadowScores.WEALTH,
      disciplineScore: shadowScores.DISCIPLINE,
    }] : []),
    ...rivals.map(r => ({
      id: r.codename,
      codename: r.codename,
      composite: computeRivalComposite(r),
      rank: r.rank,
      trajectory: r.trajectory,
      isUser: false,
      isShadow: false,
      shadowActive: r.shadowActive,
      bodyScore: r.bodyScore,
      mindScore: r.mindScore,
      wealthScore: r.wealthScore,
      disciplineScore: r.disciplineScore,
    })),
  ];

  const sorted = [...entries].sort((a, b) => b.composite - a.composite);
  const userPosition = sorted.findIndex(e => e.isUser) + 1;
  const losingTo = sorted.filter(e => !e.isUser && e.composite > userComposite).length;
  const surpassing = sorted.filter(e => !e.isUser && e.composite < userComposite).length;

  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);

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
        <View style={styles.pageHeader}>
          <View>
            <Text style={[styles.title, { color: colors.foreground }]}>RIVALS</Text>
            <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
              {sorted.length} entities ranked live
            </Text>
          </View>
          <View style={[styles.livePill, { borderColor: "#E0555540", backgroundColor: "#E0555510" }]}>
            <Animated.View style={[styles.liveDot, { opacity: pulseAnim, backgroundColor: "#E05555" }]} />
            <Text style={[styles.liveText, { color: "#E05555" }]}>LIVE</Text>
          </View>
        </View>

        {/* Your rank position */}
        <RankPositionCard
          position={userPosition}
          total={sorted.length}
          composite={userComposite}
          rank={userRank}
          surpassing={surpassing}
          losingTo={losingTo}
        />

        {/* Leaderboard */}
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>LEADERBOARD</Text>
          {sorted.map((entry, i) => (
            <LeaderRow
              key={entry.id}
              entry={entry}
              position={i + 1}
              userComposite={userComposite}
              index={i}
            />
          ))}
        </View>

        {/* Domain exposure matrix */}
        <DomainThreatMatrix
          entries={sorted.filter(e => !e.isUser)}
          userScores={userScores}
        />

        {/* Shadow self detailed card */}
        {shadowSelf.active && (
          <ShadowSelfCard
            shadow={shadowSelf}
            shadowScores={shadowScores}
            shadowRank={shadowRank}
            userScores={userScores}
          />
        )}

        {/* Entity profiles */}
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>ENTITY PROFILES</Text>
          {rivals.map(rival => (
            <RivalDetailCard
              key={rival.codename}
              rival={rival}
              userScores={userScores}
              userComposite={userComposite}
            />
          ))}
        </View>

        <View style={[styles.noticeCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Feather name="eye-off" size={12} color={colors.mutedForeground} />
          <Text style={[styles.noticeText, { color: colors.mutedForeground }]}>
            Rivals are anonymous. Scores drift daily based on trajectory. Pull down to force a sync.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { paddingHorizontal: 16, gap: 12 },
  pageHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  title: { fontSize: 14, fontWeight: "800" as const, letterSpacing: 3 },
  subtitle: { fontSize: 10, letterSpacing: 1, marginTop: 3 },
  livePill: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderRadius: 20,
  },
  liveDot: { width: 6, height: 6, borderRadius: 3 },
  liveText: { fontSize: 9, fontWeight: "700" as const, letterSpacing: 2 },
  section: { gap: 8 },
  sectionLabel: { fontSize: 9, letterSpacing: 3, fontWeight: "700" as const, marginBottom: 2 },
  noticeCard: {
    flexDirection: "row", gap: 10, padding: 12, borderRadius: 6,
    borderWidth: 1, alignItems: "flex-start",
  },
  noticeText: { flex: 1, fontSize: 10, lineHeight: 16 },
});
