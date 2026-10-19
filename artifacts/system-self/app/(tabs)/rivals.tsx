import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Animated,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import {
  useApp,
  scoreRecord,
  type Challenge,
  // Rivals rate the four original domains; they stay device-simulated until P5.
  type RivalDomain as Domain,
  type Rank,
  type Rival,
  type Trajectory,
} from "@/context/AppContext";
import { ShadowSelfCard, ShadowTakeoverTally } from "@/components/ShadowSelfCard";
import { useShadowTakeoversQuery } from "@/hooks/useGameState";
import { RankBadge } from "@/components/RankBadge";
import { ChallengeModal } from "@/components/ChallengeModal";
import { ChallengeOutcomeModal } from "@/components/ChallengeOutcomeModal";
import { RivalTauntCard } from "@/components/RivalTauntCard";
import { useSystemAI } from "@/hooks/useSystemAI";
import { RIVAL_KEYS } from "@/lib/game/rival-keys";

const DRIFT_KEY = RIVAL_KEYS.LAST_DRIFT;
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

// --- Active challenge progress card ----------------------------------------

function ActiveChallengeCard({ challenge }: { challenge: Challenge }) {
  const colors = useColors();
  const domColor = DOMAIN_COLORS[challenge.domain];
  const domIcon = DOMAIN_ICONS[challenge.domain];

  const today = new Date().toISOString().split("T")[0]!;
  const start = new Date(challenge.startDate).getTime();
  const end = new Date(challenge.endDate).getTime();
  const now = Date.now();
  const totalMs = end - start;
  const elapsedMs = Math.min(now - start, totalMs);
  const pct = Math.min(100, Math.max(0, (elapsedMs / totalMs) * 100));
  const daysLeft = Math.max(0, Math.ceil((end - now) / (1000 * 60 * 60 * 24)));

  const userGain = challenge.userCurrentScore - challenge.userStartScore;
  const rivalGain = challenge.rivalCurrentScore - challenge.rivalStartScore;
  const userLeading = userGain >= rivalGain;

  return (
    <View style={[acStyles.card, { borderColor: domColor + "40", backgroundColor: domColor + "06" }]}>
      <View style={acStyles.header}>
        <View style={acStyles.domainTag}>
          <Text style={[acStyles.domainIcon, { color: domColor }]}>{domIcon}</Text>
          <Text style={[acStyles.domainName, { color: domColor }]}>{challenge.domain}</Text>
          <Text style={[acStyles.vs, { color: colors.mutedForeground }]}>vs</Text>
          <Text style={[acStyles.rivalName, { color: colors.foreground }]} numberOfLines={1}>
            {challenge.rivalCodename.split(" // ")[1] ?? challenge.rivalCodename}
          </Text>
        </View>
        <View style={[acStyles.daysTag, { borderColor: colors.border }]}>
          <Text style={[acStyles.daysNum, { color: colors.foreground }]}>{daysLeft}</Text>
          <Text style={[acStyles.daysLabel, { color: colors.mutedForeground }]}>DAYS</Text>
        </View>
      </View>

      {/* Progress bar */}
      <View style={[acStyles.progressTrack, { backgroundColor: colors.muted }]}>
        <View style={[acStyles.progressFill, { width: `${pct}%` as `${number}%`, backgroundColor: domColor + "60" }]} />
      </View>

      {/* Gain comparison */}
      <View style={acStyles.gainRow}>
        <View style={acStyles.gainCol}>
          <Text style={[acStyles.gainLabel, { color: colors.mutedForeground }]}>YOUR GAIN</Text>
          <Text style={[acStyles.gainVal, { color: userLeading ? "#4B8B6F" : "#E05555" }]}>
            {userGain >= 0 ? `+${userGain.toFixed(1)}` : userGain.toFixed(1)}
          </Text>
        </View>
        <View style={acStyles.gainDivider} />
        <View style={acStyles.gainCol}>
          <Text style={[acStyles.gainLabel, { color: colors.mutedForeground }]}>RIVAL GAIN</Text>
          <Text style={[acStyles.gainVal, { color: !userLeading ? "#E05555" : colors.mutedForeground }]}>
            {rivalGain >= 0 ? `+${rivalGain.toFixed(1)}` : rivalGain.toFixed(1)}
          </Text>
        </View>
        <View style={acStyles.gainDivider} />
        <View style={acStyles.gainCol}>
          <Text style={[acStyles.gainLabel, { color: colors.mutedForeground }]}>STATUS</Text>
          <Text style={[acStyles.gainVal, { color: userLeading ? "#4B8B6F" : "#E05555", fontSize: 10 }]}>
            {userLeading ? "LEADING" : "TRAILING"}
          </Text>
        </View>
      </View>
    </View>
  );
}

const acStyles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 6, padding: 14, gap: 10 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  domainTag: { flexDirection: "row", alignItems: "center", gap: 6, flex: 1 },
  domainIcon: { fontSize: 12 },
  domainName: { fontSize: 10, fontWeight: "800" as const, letterSpacing: 2 },
  vs: { fontSize: 8, letterSpacing: 1 },
  rivalName: { fontSize: 10, fontWeight: "600" as const, flex: 1 },
  daysTag: {
    borderWidth: 1, borderRadius: 3, paddingHorizontal: 8, paddingVertical: 4,
    alignItems: "center",
  },
  daysNum: { fontSize: 14, fontWeight: "800" as const, lineHeight: 18 },
  daysLabel: { fontSize: 6, letterSpacing: 2, fontWeight: "700" as const },
  progressTrack: { height: 3, borderRadius: 2, overflow: "hidden" },
  progressFill: { height: "100%", borderRadius: 2 },
  gainRow: { flexDirection: "row", alignItems: "center" },
  gainCol: { flex: 1, alignItems: "center", gap: 3 },
  gainLabel: { fontSize: 7, letterSpacing: 2, fontWeight: "600" as const },
  gainVal: { fontSize: 14, fontWeight: "800" as const },
  gainDivider: { width: StyleSheet.hairlineWidth, height: 28, backgroundColor: "#2A2D38" },
});

// --- Rival detail card ------------------------------------------------------

function RivalDetailCard({
  rival, userScores, userComposite, activeChallenge, onChallenge,
}: {
  rival: Rival;
  userScores: Record<Domain, number>;
  userComposite: number;
  activeChallenge: Challenge | null;
  onChallenge: (rival: Rival) => void;
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

  const activeDomColor = activeChallenge ? DOMAIN_COLORS[activeChallenge.domain] : null;

  return (
    <View style={[detailStyles.card, { borderColor: colors.border, backgroundColor: colors.card }]}>
      <View style={detailStyles.header}>
        <View style={detailStyles.headerLeft}>
          <Text style={[detailStyles.codename, { color: colors.foreground }]}>{rival.codename}</Text>
          <View style={detailStyles.tagRow}>
            {rival.shadowActive && (
              <View style={[detailStyles.shadowTag, { borderColor: "#E0555550" }]}>
                <Text style={[detailStyles.shadowTagText, { color: "#E05555" }]}>SHADOW ACTIVE</Text>
              </View>
            )}
            {activeChallenge && activeDomColor && (
              <View style={[detailStyles.challengeTag, { borderColor: activeDomColor + "60", backgroundColor: activeDomColor + "10" }]}>
                <Feather name="zap" size={8} color={activeDomColor} />
                <Text style={[detailStyles.challengeTagText, { color: activeDomColor }]}>
                  CHALLENGED · {activeChallenge.domain}
                </Text>
              </View>
            )}
          </View>
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

      {/* Challenge button */}
      {!activeChallenge ? (
        <Pressable
          style={({ pressed }) => [detailStyles.challengeBtn, {
            borderColor: colors.primary + "50",
            backgroundColor: colors.primary + "08",
            opacity: pressed ? 0.6 : 1,
          }]}
          onPress={() => onChallenge(rival)}
        >
          <Feather name="zap" size={11} color={colors.primary} />
          <Text style={[detailStyles.challengeBtnText, { color: colors.primary }]}>
            DECLARE 7-DAY CHALLENGE
          </Text>
        </Pressable>
      ) : (
        <View style={[detailStyles.challengeActiveNote, { borderColor: activeDomColor + "30" }]}>
          <Feather name="clock" size={10} color={activeDomColor ?? "#3A3D48"} />
          <Text style={[detailStyles.challengeActiveText, { color: activeDomColor ?? "#3A3D48" }]}>
            Challenge active · {activeChallenge.domain} · ends {activeChallenge.endDate}
          </Text>
        </View>
      )}
    </View>
  );
}

const detailStyles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 6, padding: 16, gap: 12 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  headerLeft: { gap: 5, flex: 1 },
  codename: { fontSize: 13, fontWeight: "700" as const, letterSpacing: 0.3 },
  tagRow: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  shadowTag: { borderWidth: 1, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 3 },
  shadowTagText: { fontSize: 7, fontWeight: "800" as const, letterSpacing: 2 },
  challengeTag: {
    flexDirection: "row", alignItems: "center", gap: 4,
    borderWidth: 1, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 3,
  },
  challengeTagText: { fontSize: 7, fontWeight: "800" as const, letterSpacing: 1.5 },
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
  challengeBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 7, borderWidth: 1, borderRadius: 4, paddingVertical: 11,
  },
  challengeBtnText: { fontSize: 10, fontWeight: "800" as const, letterSpacing: 2.5 },
  challengeActiveNote: {
    flexDirection: "row", alignItems: "center", gap: 7,
    borderWidth: 1, borderRadius: 4, paddingVertical: 9, paddingHorizontal: 12,
  },
  challengeActiveText: { fontSize: 9, fontWeight: "600" as const, letterSpacing: 1, flex: 1 },
});

// --- Main screen ------------------------------------------------------------

export default function RivalsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const {
    rivals, domainScores, shadowSelf, user,
    getShadowScores, getShadowRank,
    updateRivals, challenges, challengeRecord,
    declareChallenge, acknowledgeChallenge,
    rivalTaunts, addRivalTaunt, markRivalTauntsRead,
  } = useApp();
  const { generateRivalTaunt } = useSystemAI();
  const takeovers = useShadowTakeoversQuery().data?.items ?? [];

  const [refreshing, setRefreshing] = useState(false);
  const [challengeTarget, setChallengeTarget] = useState<Rival | null>(null);
  const [pendingOutcome, setPendingOutcome] = useState<Challenge | null>(null);
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

  // Server scores; rivals compare on the four domains they have.
  const userScores: Record<Domain, number> = {
    BODY: domainScores.find(s => s.domain === "BODY")?.score ?? 0,
    MIND: domainScores.find(s => s.domain === "MIND")?.score ?? 0,
    WEALTH: domainScores.find(s => s.domain === "WEALTH")?.score ?? 0,
    DISCIPLINE: domainScores.find(s => s.domain === "DISCIPLINE")?.score ?? 0,
  };

  const shadowScores = getShadowScores();
  const shadowRank = getShadowRank();
  const userRank = user?.rank ?? "E";
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

  // Challenge helpers
  const activeChallenges = challenges.filter(c => c.outcome === null);
  const pendingAcknowledge = challenges.find(
    c => c.outcome !== null && !c.acknowledged
  ) ?? null;

  const getActiveChallenge = (rivalCodename: string): Challenge | null =>
    activeChallenges.find(c => c.rivalCodename === rivalCodename) ?? null;

  const handleDeclare = async (domain: Domain) => {
    if (!challengeTarget) return;
    await declareChallenge(challengeTarget.codename, challengeTarget.rank, domain);
    setChallengeTarget(null);
  };

  const handleAcknowledge = async () => {
    if (!pendingAcknowledge) return;
    await acknowledgeChallenge(pendingAcknowledge.id);
    setPendingOutcome(null);
  };

  // Show outcome modal when a new unacknowledged result appears
  useEffect(() => {
    if (pendingAcknowledge && !pendingOutcome) {
      setPendingOutcome(pendingAcknowledge);
    }
  }, [pendingAcknowledge]);

  const totalRecord = challengeRecord.wins + challengeRecord.losses + challengeRecord.draws;
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

        {/* Challenge record strip */}
        {totalRecord > 0 && (
          <View style={[styles.recordStrip, { borderColor: colors.border, backgroundColor: colors.card }]}>
            <Text style={[styles.recordTitle, { color: colors.mutedForeground }]}>CHALLENGE RECORD</Text>
            <View style={styles.recordCols}>
              <View style={styles.recordCol}>
                <Text style={[styles.recordNum, { color: "#4B8B6F" }]}>{challengeRecord.wins}</Text>
                <Text style={[styles.recordLabel, { color: colors.mutedForeground }]}>WIN</Text>
              </View>
              <View style={[styles.recordDivider, { backgroundColor: colors.border }]} />
              <View style={styles.recordCol}>
                <Text style={[styles.recordNum, { color: "#E05555" }]}>{challengeRecord.losses}</Text>
                <Text style={[styles.recordLabel, { color: colors.mutedForeground }]}>LOSS</Text>
              </View>
              <View style={[styles.recordDivider, { backgroundColor: colors.border }]} />
              <View style={styles.recordCol}>
                <Text style={[styles.recordNum, { color: "#C4873A" }]}>{challengeRecord.draws}</Text>
                <Text style={[styles.recordLabel, { color: colors.mutedForeground }]}>DRAW</Text>
              </View>
            </View>
          </View>
        )}

        {/* Your rank position */}
        <RankPositionCard
          position={userPosition}
          total={sorted.length}
          composite={userComposite}
          rank={userRank}
          surpassing={surpassing}
          losingTo={losingTo}
        />

        {/* Active challenges */}
        {activeChallenges.length > 0 && (
          <View style={styles.section}>
            <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>ACTIVE CHALLENGES</Text>
            {activeChallenges.map(c => (
              <ActiveChallengeCard key={c.id} challenge={c} />
            ))}
          </View>
        )}

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
            userScores={scoreRecord(domainScores)}
            takeovers={takeovers}
          />
        )}
        {!shadowSelf.active && <ShadowTakeoverTally takeovers={takeovers} dormant />}

        {/* Entity profiles */}
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>ENTITY PROFILES</Text>
          {rivals.map(rival => (
            <RivalDetailCard
              key={rival.codename}
              rival={rival}
              userScores={scoreRecord(domainScores)}
              userComposite={userComposite}
              activeChallenge={getActiveChallenge(rival.codename)}
              onChallenge={setChallengeTarget}
            />
          ))}
        </View>

        {/* Rival Taunts */}
        {rivalTaunts.length > 0 && (
          <View style={styles.section}>
            <View style={styles.tauntHeader}>
              <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>INCOMING TRANSMISSIONS</Text>
              {rivalTaunts.some(t => !t.read) && (
                <View style={[styles.unreadBadge, { backgroundColor: "#E05555" }]}>
                  <Text style={styles.unreadCount}>
                    {rivalTaunts.filter(t => !t.read).length}
                  </Text>
                </View>
              )}
              <TouchableOpacity
                onPress={markRivalTauntsRead}
                activeOpacity={0.7}
                style={[styles.markReadBtn, { borderColor: colors.border }]}
              >
                <Text style={[styles.markReadText, { color: colors.mutedForeground }]}>MARK READ</Text>
              </TouchableOpacity>
            </View>
            {rivalTaunts.slice().reverse().map(taunt => (
              <RivalTauntCard key={taunt.id} taunt={taunt} />
            ))}
          </View>
        )}

        {/* Generate taunt from rivals */}
        {rivals.length > 0 && (
          <TouchableOpacity
            style={[styles.tauntGenBtn, { borderColor: colors.border, backgroundColor: colors.card }]}
            onPress={async () => {
              const rival = rivals[Math.floor(Math.random() * rivals.length)];
              if (!rival || !user) return;
              const msg = await generateRivalTaunt({
                rivalCodename: rival.codename,
                rivalRank: rival.rank,
                rivalTrajectory: rival.trajectory,
              });
              await addRivalTaunt({ rivalCodename: rival.codename, message: msg });
            }}
            activeOpacity={0.7}
          >
            <Feather name="message-circle" size={12} color="#E05555" />
            <Text style={[styles.tauntGenText, { color: "#E05555" }]}>REQUEST RIVAL TRANSMISSION</Text>
          </TouchableOpacity>
        )}

        <View style={[styles.noticeCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Feather name="eye-off" size={12} color={colors.mutedForeground} />
          <Text style={[styles.noticeText, { color: colors.mutedForeground }]}>
            Rivals are anonymous. Scores drift daily. Pull to sync. Challenges track 7-day domain gains.
          </Text>
        </View>
      </ScrollView>

      {/* Challenge declaration modal */}
      <ChallengeModal
        visible={challengeTarget !== null}
        rival={challengeTarget}
        onClose={() => setChallengeTarget(null)}
        onDeclare={handleDeclare}
      />

      {/* Challenge outcome modal */}
      <ChallengeOutcomeModal
        visible={pendingOutcome !== null}
        challenge={pendingOutcome}
        onAcknowledge={handleAcknowledge}
      />
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
  recordStrip: {
    borderWidth: 1, borderRadius: 6,
    paddingVertical: 12, paddingHorizontal: 16, gap: 8,
  },
  recordTitle: { fontSize: 8, letterSpacing: 3, fontWeight: "700" as const },
  recordCols: { flexDirection: "row", alignItems: "center" },
  recordCol: { flex: 1, alignItems: "center", gap: 3 },
  recordNum: { fontSize: 22, fontWeight: "800" as const },
  recordLabel: { fontSize: 7, letterSpacing: 2, fontWeight: "700" as const },
  recordDivider: { width: StyleSheet.hairlineWidth, height: 28 },
  section: { gap: 8 },
  sectionLabel: { fontSize: 9, letterSpacing: 3, fontWeight: "700" as const, marginBottom: 2 },
  noticeCard: {
    flexDirection: "row", gap: 10, padding: 12, borderRadius: 6,
    borderWidth: 1, alignItems: "flex-start",
  },
  noticeText: { flex: 1, fontSize: 10, lineHeight: 16 },
  tauntHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  unreadBadge: {
    minWidth: 18, height: 18, borderRadius: 9,
    alignItems: "center", justifyContent: "center", paddingHorizontal: 4,
  },
  unreadCount: { fontSize: 9, fontWeight: "800" as const, color: "#fff" },
  markReadBtn: { marginLeft: "auto", borderWidth: 1, borderRadius: 2, paddingHorizontal: 8, paddingVertical: 3 },
  markReadText: { fontSize: 8, fontWeight: "700" as const, letterSpacing: 1.5 },
  tauntGenBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, borderWidth: 1, borderRadius: 4, padding: 12,
  },
  tauntGenText: { fontSize: 10, fontWeight: "700" as const, letterSpacing: 2 },
});
