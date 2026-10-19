// Rivals tab: the server's rivals (GET /api/rivals), polled every minute while focused. Ghost rivals (server
// simulations for the cold start) carry a SIM tag. The composite is the plain mean of the five visible domain
// scores; the hidden score never reaches the app.
import React, { useEffect, useRef, useState } from "react";
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
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { RankedDomain, Rival, RivalChallenge } from "@workspace/contracts";
import { useColors } from "@/hooks/useColors";
import { useApp, scoreRecord, type Domain } from "@/context/AppContext";
import { ShadowSelfCard, ShadowTakeoverTally } from "@/components/ShadowSelfCard";
import { useGameStateQuery, usePastSelfQuery, useShadowTakeoversQuery } from "@/hooks/useGameState";
import { useRivalActions, useRivalsQuery } from "@/hooks/useRivals";
import { PastSelfCard } from "@/components/PastSelfCard";
import { RankBadge } from "@/components/RankBadge";
import { ChallengeModal, type ChallengeTarget } from "@/components/ChallengeModal";
import { RivalTauntCard } from "@/components/RivalTauntCard";
import { ALL_DOMAINS as DOMAINS, DOMAIN_COLORS, DOMAIN_GLYPHS as DOMAIN_ICONS } from "@/constants/domains";
import {
  buildLeaderboard,
  challengeProgress,
  composite as compositeOf,
  describeRivalError,
  leaderStatus,
  shortCodename,
  type LeaderEntry,
  type LeaderStatus,
} from "@/lib/social/rivals";

const SIM_COLOR = "#8A8FA3";

function SimTag() {
  return (
    <View style={[leaderStyles.youTag, { borderColor: SIM_COLOR + "60" }]} accessibilityLabel="Simulated rival">
      <Text style={[leaderStyles.youText, { color: SIM_COLOR }]}>SIM</Text>
    </View>
  );
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
  const status = leaderStatus(entry, userComposite);
  const delta = entry.composite - userComposite;
  const isUser = entry.kind === "you";
  const isShadow = entry.kind === "shadow";
  const isFirst = position === 1;

  useEffect(() => {
    const t = setTimeout(() => {
      Animated.timing(rowAnim, { toValue: 1, duration: 280, useNativeDriver: false }).start();
    }, index * 70);
    return () => clearTimeout(t);
  }, []);

  const posColor = isFirst ? "#D4B483" : isUser ? colors.primary : colors.mutedForeground;
  const borderColor = isUser ? colors.primary + "60" : isShadow ? "#E0555550" : colors.border;
  const bgColor = isUser ? colors.primary + "08" : isShadow ? "#E0555506" : "transparent";

  const statusColorMap: Record<LeaderStatus, string> = {
    THREATENING: "#E05555",
    CLOSING: "#C4873A",
    AHEAD: colors.mutedForeground,
    BEHIND: "#4B8B6F",
    SHADOW: "#E05555",
  };

  const trajectoryIcon = entry.trajectory === "up" ? "↑" : entry.trajectory === "down" ? "↓" : "→";
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
            {entry.label}
          </Text>
          {isUser && (
            <View style={[leaderStyles.youTag, { borderColor: colors.primary + "60" }]}>
              <Text style={[leaderStyles.youText, { color: colors.primary }]}>YOU</Text>
            </View>
          )}
          {entry.isGhost && <SimTag />}
        </View>
        <View style={leaderStyles.metaRow}>
          <Text style={[leaderStyles.composite, { color: colors.foreground }]}>
            {entry.composite.toFixed(1)}
          </Text>
          <Text style={[leaderStyles.trajectory, { color: trajectoryColor }]}>
            {trajectoryIcon}
          </Text>
          {!isUser && (
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

// --- Domain threat matrix --------------------------------------------------

function DomainThreatMatrix({ rivals, userScores }: { rivals: Rival[]; userScores: Record<Domain, number> }) {
  const colors = useColors();
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

      {rivals.map(r => (
        <View key={r.assignmentId} style={matrixStyles.tableRow}>
          <Text style={[matrixStyles.rivalName, { color: colors.mutedForeground }]} numberOfLines={1}>
            {shortCodename(r.codename)}
          </Text>
          {DOMAINS.map(d => {
            const diff = (r.profile.scores?.[d] ?? 0) - userScores[d];
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

// --- Rank position card ----------------------------------------------------

function RankPositionCard({
  position, total, composite, rank, surpassing, losingTo,
}: {
  position: number;
  total: number;
  composite: number;
  rank: LeaderEntry["rank"];
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

// --- Challenge cards --------------------------------------------------------

function ActiveChallengeCard({ challenge, today }: { challenge: RivalChallenge; today: string }) {
  const colors = useColors();
  const domColor = DOMAIN_COLORS[challenge.domain];
  const domIcon = DOMAIN_ICONS[challenge.domain];
  const p = challengeProgress(challenge, today);

  return (
    <View style={[acStyles.card, { borderColor: domColor + "40", backgroundColor: domColor + "06" }]}>
      <View style={acStyles.header}>
        <View style={acStyles.domainTag}>
          <Text style={[acStyles.domainIcon, { color: domColor }]}>{domIcon}</Text>
          <Text style={[acStyles.domainName, { color: domColor }]}>{challenge.domain}</Text>
          <Text style={[acStyles.vs, { color: colors.mutedForeground }]}>vs</Text>
          <Text style={[acStyles.rivalName, { color: colors.foreground }]} numberOfLines={1}>
            {shortCodename(challenge.codename)}
          </Text>
        </View>
        <View style={[acStyles.daysTag, { borderColor: colors.border }]}>
          <Text style={[acStyles.daysNum, { color: colors.foreground }]}>{p.daysLeft}</Text>
          <Text style={[acStyles.daysLabel, { color: colors.mutedForeground }]}>DAYS</Text>
        </View>
      </View>

      <View style={[acStyles.progressTrack, { backgroundColor: colors.muted }]}>
        <View style={[acStyles.progressFill, { width: `${p.pct}%` as `${number}%`, backgroundColor: domColor + "60" }]} />
      </View>

      <View style={acStyles.gainRow}>
        <View style={acStyles.gainCol}>
          <Text style={[acStyles.gainLabel, { color: colors.mutedForeground }]}>YOUR GAIN</Text>
          <Text style={[acStyles.gainVal, { color: p.leading ? "#4B8B6F" : "#E05555" }]}>
            {p.userGain >= 0 ? `+${p.userGain.toFixed(1)}` : p.userGain.toFixed(1)}
          </Text>
        </View>
        <View style={acStyles.gainDivider} />
        <View style={acStyles.gainCol}>
          <Text style={[acStyles.gainLabel, { color: colors.mutedForeground }]}>RIVAL GAIN</Text>
          <Text style={[acStyles.gainVal, { color: !p.leading ? "#E05555" : colors.mutedForeground }]}>
            {p.rivalGain >= 0 ? `+${p.rivalGain.toFixed(1)}` : p.rivalGain.toFixed(1)}
          </Text>
        </View>
        <View style={acStyles.gainDivider} />
        <View style={acStyles.gainCol}>
          <Text style={[acStyles.gainLabel, { color: colors.mutedForeground }]}>STATUS</Text>
          <Text style={[acStyles.gainVal, { color: p.leading ? "#4B8B6F" : "#E05555", fontSize: 10 }]}>
            {p.leading ? "LEADING" : "TRAILING"}
          </Text>
        </View>
      </View>
    </View>
  );
}

const OUTCOME_LABEL = { win: "VICTORY", loss: "DEFEAT", draw: "STALEMATE", void: "VOID" } as const;
const OUTCOME_COLOR = { win: "#4B8B6F", loss: "#E05555", draw: "#C4873A", void: SIM_COLOR } as const;

function ResultRow({ challenge, onAcknowledge }: { challenge: RivalChallenge; onAcknowledge: () => void }) {
  const colors = useColors();
  const outcome = challenge.outcome ?? "void";
  const color = OUTCOME_COLOR[outcome];
  return (
    <View style={[extraStyles.resultRow, { borderColor: colors.border }]}>
      <Text style={[extraStyles.resultLabel, { color }]}>{OUTCOME_LABEL[outcome]}</Text>
      <Text style={[extraStyles.resultText, { color: colors.mutedForeground }]} numberOfLines={1}>
        {challenge.domain} vs {shortCodename(challenge.codename)} · {challenge.endDate}
      </Text>
      {!challenge.acknowledged && outcome !== "void" && (
        <TouchableOpacity onPress={onAcknowledge} accessibilityRole="button" style={[styles.markReadBtn, { borderColor: color + "60" }]}>
          <Text style={[styles.markReadText, { color }]}>ACKNOWLEDGE</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// --- Rival detail card ------------------------------------------------------

function RivalDetailCard({
  rival, userScores, userComposite, activeChallenge, onChallenge, onTaunt, taunting,
}: {
  rival: Rival;
  userScores: Record<Domain, number>;
  userComposite: number;
  activeChallenge: RivalChallenge | null;
  onChallenge: (rival: Rival) => void;
  onTaunt: (rival: Rival) => void;
  taunting: boolean;
}) {
  const colors = useColors();
  const p = rival.profile;
  const scores = p.scores ?? (Object.fromEntries(DOMAINS.map((d) => [d, 0])) as Record<Domain, number>);
  const rivalComposite = compositeOf(scores);
  const delta = rivalComposite - userComposite;
  const isAhead = delta > 0;

  const trajectoryIcon = p.trajectory === "up" ? "↑" : p.trajectory === "down" ? "↓" : "→";
  const trajectoryColor =
    p.trajectory === "up" ? (isAhead ? "#E05555" : "#C4873A") :
    p.trajectory === "down" ? "#4B8B6F" :
    colors.mutedForeground;

  const activeDomColor = activeChallenge ? DOMAIN_COLORS[activeChallenge.domain] : null;

  return (
    <View style={[detailStyles.card, { borderColor: colors.border, backgroundColor: colors.card }]}>
      <View style={detailStyles.header}>
        <View style={detailStyles.headerLeft}>
          <Text style={[detailStyles.codename, { color: colors.foreground }]}>{rival.codename}</Text>
          <View style={detailStyles.tagRow}>
            {rival.isGhost && <SimTag />}
            {p.shadowActive && (
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
          <RankBadge rank={p.rank} size="sm" />
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
          const rivalScore = scores[d];
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

      {!activeChallenge ? (
        <Pressable
          style={({ pressed }) => [detailStyles.challengeBtn, {
            borderColor: colors.primary + "50",
            backgroundColor: colors.primary + "08",
            opacity: pressed ? 0.6 : 1,
          }]}
          onPress={() => onChallenge(rival)}
          accessibilityRole="button"
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

      <TouchableOpacity
        style={[styles.tauntGenBtn, { borderColor: colors.border, opacity: taunting ? 0.5 : 1 }]}
        onPress={() => onTaunt(rival)}
        disabled={taunting}
        activeOpacity={0.7}
        accessibilityRole="button"
      >
        <Feather name="message-circle" size={12} color="#E05555" />
        <Text style={[styles.tauntGenText, { color: "#E05555" }]}>REQUEST TRANSMISSION</Text>
      </TouchableOpacity>
    </View>
  );
}

// --- Main screen ------------------------------------------------------------

export default function RivalsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { domainScores, shadowSelf, user, trajectory, getShadowScores, getShadowRank } = useApp();
  const today = useGameStateQuery().data?.today ?? new Date().toISOString().slice(0, 10);
  const rivalsQ = useRivalsQuery();
  const actions = useRivalActions();
  const takeovers = useShadowTakeoversQuery().data?.items ?? [];
  const pastSelf = usePastSelfQuery().data;

  const [refreshing, setRefreshing] = useState(false);
  const [challengeTarget, setChallengeTarget] = useState<Rival | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [taunting, setTaunting] = useState<string | null>(null);
  const pulseAnim = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1, duration: 1200, useNativeDriver: false }),
        Animated.timing(pulseAnim, { toValue: 0.4, duration: 1200, useNativeDriver: false }),
      ])
    ).start();
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await rivalsQ.refetch();
    setRefreshing(false);
  };

  const userScores = scoreRecord(domainScores);
  const data = rivalsQ.data;
  const rivals = data?.rivals ?? [];
  const board = data
    ? buildLeaderboard({ handle: user?.username ?? "YOU", rank: user?.rank ?? "E", trajectory, scores: userScores }, data)
    : null;
  const challenges = data?.challenges ?? [];
  const activeChallenges = challenges.filter((c) => c.outcome === null);
  const results = challenges.filter((c) => c.outcome !== null);
  const record = data?.record ?? { wins: 0, losses: 0, draws: 0 };
  const taunts = data?.taunts ?? [];
  const totalRecord = record.wins + record.losses + record.draws;
  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);

  const activeFor = (assignmentId: string) => activeChallenges.find((c) => c.assignmentId === assignmentId) ?? null;
  const target: ChallengeTarget | null = challengeTarget
    ? {
        codename: challengeTarget.codename,
        rank: challengeTarget.profile.rank,
        trajectory: challengeTarget.profile.trajectory,
        scores: (challengeTarget.profile.scores ?? userScores) as Record<Domain, number>,
      }
    : null;

  const report = (r: { ok: boolean }) => {
    if (!r.ok) setError("Queued entries are still syncing. Retry once they land.");
  };
  const handleDeclare = async (domain: Domain) => {
    if (!challengeTarget) return;
    setError(null);
    try {
      report(await actions.challenge(challengeTarget.assignmentId, domain as RankedDomain));
    } catch (e) {
      setError(describeRivalError(e));
    }
  };
  const handleTaunt = async (rival: Rival) => {
    if (taunting) return;
    setError(null);
    setTaunting(rival.assignmentId);
    try {
      report(await actions.taunt(rival.assignmentId));
    } catch (e) {
      setError(describeRivalError(e));
    } finally {
      setTaunting(null);
    }
  };
  const handleAck = async (challengeId: string) => {
    setError(null);
    try {
      report(await actions.acknowledge(challengeId));
    } catch (e) {
      setError(describeRivalError(e));
    }
  };
  const handleMarkRead = async () => {
    try {
      report(await actions.markRead());
    } catch (e) {
      setError(describeRivalError(e));
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
        <View style={styles.pageHeader}>
          <View>
            <Text style={[styles.title, { color: colors.foreground }]}>RIVALS</Text>
            <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
              {board ? `${board.entries.length} entities ranked live` : "Syncing rivals"}
            </Text>
          </View>
          <View style={styles.headerRight}>
            <TouchableOpacity
              onPress={() => router.push("/social/search")}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityRole="button"
              accessibilityLabel="Find players"
            >
              <Feather name="users" size={20} color={colors.mutedForeground} />
            </TouchableOpacity>
            <View style={[styles.livePill, { borderColor: "#E0555540", backgroundColor: "#E0555510" }]}>
              <Animated.View style={[styles.liveDot, { opacity: pulseAnim, backgroundColor: "#E05555" }]} />
              <Text style={[styles.liveText, { color: "#E05555" }]}>LIVE</Text>
            </View>
          </View>
        </View>

        {/* Past You: the main comparison, first under the header */}
        {pastSelf ? <PastSelfCard data={pastSelf} /> : null}

        {error && (
          <Text style={[extraStyles.error, { color: "#E05555" }]} accessibilityLiveRegion="polite">{error}</Text>
        )}
        {!data && rivalsQ.isError && (
          <TouchableOpacity onPress={() => void rivalsQ.refetch()} accessibilityRole="button" style={[styles.noticeCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name="wifi-off" size={12} color={colors.mutedForeground} />
            <Text style={[styles.noticeText, { color: colors.mutedForeground }]}>
              {describeRivalError(rivalsQ.error)} Tap to retry.
            </Text>
          </TouchableOpacity>
        )}

        {/* Challenge record strip */}
        {totalRecord > 0 && (
          <View style={[styles.recordStrip, { borderColor: colors.border, backgroundColor: colors.card }]}>
            <Text style={[styles.recordTitle, { color: colors.mutedForeground }]}>CHALLENGE RECORD</Text>
            <View style={styles.recordCols}>
              <View style={styles.recordCol}>
                <Text style={[styles.recordNum, { color: "#4B8B6F" }]}>{record.wins}</Text>
                <Text style={[styles.recordLabel, { color: colors.mutedForeground }]}>WIN</Text>
              </View>
              <View style={[styles.recordDivider, { backgroundColor: colors.border }]} />
              <View style={styles.recordCol}>
                <Text style={[styles.recordNum, { color: "#E05555" }]}>{record.losses}</Text>
                <Text style={[styles.recordLabel, { color: colors.mutedForeground }]}>LOSS</Text>
              </View>
              <View style={[styles.recordDivider, { backgroundColor: colors.border }]} />
              <View style={styles.recordCol}>
                <Text style={[styles.recordNum, { color: "#C4873A" }]}>{record.draws}</Text>
                <Text style={[styles.recordLabel, { color: colors.mutedForeground }]}>DRAW</Text>
              </View>
            </View>
          </View>
        )}

        {/* Your rank position */}
        {board && (
          <RankPositionCard
            position={board.position}
            total={board.entries.length}
            composite={board.userComposite}
            rank={user?.rank ?? "E"}
            surpassing={board.surpassing}
            losingTo={board.losingTo}
          />
        )}

        {/* Active challenges */}
        {activeChallenges.length > 0 && (
          <View style={styles.section}>
            <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>ACTIVE CHALLENGES</Text>
            {activeChallenges.map(c => (
              <ActiveChallengeCard key={c.id} challenge={c} today={today} />
            ))}
          </View>
        )}

        {/* Leaderboard (you, your shadow, your rivals) */}
        {board && (
          <View style={styles.section}>
            <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>LEADERBOARD</Text>
            {board.entries.map((entry, i) => (
              <LeaderRow
                key={entry.id}
                entry={entry}
                position={i + 1}
                userComposite={board.userComposite}
                index={i}
              />
            ))}
          </View>
        )}

        {/* Domain exposure matrix */}
        <DomainThreatMatrix rivals={rivals} userScores={userScores} />

        {/* Shadow self detailed card */}
        {shadowSelf.active && (
          <ShadowSelfCard
            shadow={shadowSelf}
            shadowScores={getShadowScores()}
            shadowRank={getShadowRank()}
            userScores={userScores}
            takeovers={takeovers}
          />
        )}
        {!shadowSelf.active && <ShadowTakeoverTally takeovers={takeovers} dormant />}

        {/* Entity profiles */}
        {rivals.length > 0 && (
          <View style={styles.section}>
            <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>ENTITY PROFILES</Text>
            {rivals.map(rival => (
              <RivalDetailCard
                key={rival.assignmentId}
                rival={rival}
                userScores={userScores}
                userComposite={board?.userComposite ?? 0}
                activeChallenge={activeFor(rival.assignmentId)}
                onChallenge={setChallengeTarget}
                onTaunt={handleTaunt}
                taunting={taunting === rival.assignmentId}
              />
            ))}
          </View>
        )}

        {/* Recent challenge results */}
        {results.length > 0 && (
          <View style={styles.section}>
            <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>RECENT RESULTS</Text>
            {results.map(c => (
              <ResultRow key={c.id} challenge={c} onAcknowledge={() => void handleAck(c.id)} />
            ))}
          </View>
        )}

        {/* Rival transmissions */}
        {taunts.length > 0 && (
          <View style={styles.section}>
            <View style={styles.tauntHeader}>
              <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>INCOMING TRANSMISSIONS</Text>
              {taunts.some(t => !t.read) && (
                <View style={[styles.unreadBadge, { backgroundColor: "#E05555" }]}>
                  <Text style={styles.unreadCount}>
                    {taunts.filter(t => !t.read).length}
                  </Text>
                </View>
              )}
              <TouchableOpacity
                onPress={() => void handleMarkRead()}
                activeOpacity={0.7}
                style={[styles.markReadBtn, { borderColor: colors.border }]}
                accessibilityRole="button"
              >
                <Text style={[styles.markReadText, { color: colors.mutedForeground }]}>MARK READ</Text>
              </TouchableOpacity>
            </View>
            {taunts.map(taunt => (
              <RivalTauntCard key={taunt.id} taunt={taunt} />
            ))}
          </View>
        )}

        <View style={[styles.noticeCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Feather name="eye-off" size={12} color={colors.mutedForeground} />
          <Text style={[styles.noticeText, { color: colors.mutedForeground }]}>
            Rivals are shown by codename only. SIM marks a simulated rival until a real match is found. Slots
            re-match every 30 days and on a rank change. Challenges track 7-day domain gains.
          </Text>
        </View>
      </ScrollView>

      <ChallengeModal
        visible={challengeTarget !== null}
        rival={target}
        onClose={() => setChallengeTarget(null)}
        onDeclare={(d) => void handleDeclare(d)}
      />
    </View>
  );
}

const extraStyles = StyleSheet.create({
  error: { fontSize: 11, letterSpacing: 0.5 },
  resultRow: {
    flexDirection: "row", alignItems: "center", gap: 10,
    borderWidth: 1, borderRadius: 4, paddingVertical: 8, paddingHorizontal: 12,
  },
  resultLabel: { fontSize: 9, fontWeight: "800" as const, letterSpacing: 2, width: 72 },
  resultText: { flex: 1, fontSize: 10, letterSpacing: 0.5 },
});

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

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { paddingHorizontal: 16, gap: 12 },
  pageHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 14 },
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
