import React, { useEffect, useRef } from "react";
import {
  Animated,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Feather } from "@expo/vector-icons";
import { DOMAIN_COLORS, DOMAIN_GLYPHS as DOMAIN_ICONS } from "@/constants/domains";
import type { ChallengeResultView } from "@/lib/game/notices";

interface Props {
  /** A resolved rival challenge (from its rival_challenge_result notice). */
  result: ChallengeResultView | null;
  visible: boolean;
  onAcknowledge: () => void;
}

function OutcomeConfig(outcome: ChallengeResultView["outcome"]) {
  switch (outcome) {
    case "win": return {
      label: "VICTORY",
      sub: "The rival has been suppressed.",
      color: "#4B8B6F",
      glowColors: ["#4B8B6F08", "transparent", "#4B8B6F06"] as [string, string, string],
      icon: "arrow-up" as const,
    };
    case "loss": return {
      label: "DEFEAT",
      sub: "The rival has outpaced you. Correct course.",
      color: "#E05555",
      glowColors: ["#E0555508", "transparent", "#E0555506"] as [string, string, string],
      icon: "arrow-down" as const,
    };
    case "draw": return {
      label: "STALEMATE",
      sub: "Neither entity gained significant ground.",
      color: "#C4873A",
      glowColors: ["#C4873A08", "transparent", "#C4873A06"] as [string, string, string],
      icon: "minus" as const,
    };
  }
}

export function ChallengeOutcomeModal({ result: challenge, visible, onAcknowledge }: Props) {
  const overlayOpacity = useRef(new Animated.Value(0)).current;
  const headerOpacity = useRef(new Animated.Value(0)).current;
  const headerY = useRef(new Animated.Value(-16)).current;
  const outcomeScale = useRef(new Animated.Value(0.8)).current;
  const outcomeOpacity = useRef(new Animated.Value(0)).current;
  const statsOpacity = useRef(new Animated.Value(0)).current;
  const btnOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) return;

    overlayOpacity.setValue(0);
    headerOpacity.setValue(0);
    headerY.setValue(-16);
    outcomeScale.setValue(0.8);
    outcomeOpacity.setValue(0);
    statsOpacity.setValue(0);
    btnOpacity.setValue(0);

    const timers: ReturnType<typeof setTimeout>[] = [];

    Animated.timing(overlayOpacity, { toValue: 1, duration: 400, useNativeDriver: false }).start();

    timers.push(setTimeout(() => {
      Animated.parallel([
        Animated.timing(headerOpacity, { toValue: 1, duration: 350, useNativeDriver: false }),
        Animated.timing(headerY, { toValue: 0, duration: 350, useNativeDriver: false }),
      ]).start();
    }, 350));

    timers.push(setTimeout(() => {
      Animated.parallel([
        Animated.spring(outcomeScale, { toValue: 1, friction: 5, tension: 80, useNativeDriver: false }),
        Animated.timing(outcomeOpacity, { toValue: 1, duration: 300, useNativeDriver: false }),
      ]).start();
    }, 700));

    timers.push(setTimeout(() => {
      Animated.timing(statsOpacity, { toValue: 1, duration: 400, useNativeDriver: false }).start();
    }, 1100));

    timers.push(setTimeout(() => {
      Animated.timing(btnOpacity, { toValue: 1, duration: 400, useNativeDriver: false }).start();
    }, 1700));

    return () => timers.forEach(clearTimeout);
  }, [visible]);

  if (!challenge || !challenge.outcome) return null;

  const config = OutcomeConfig(challenge.outcome);
  const domColor = DOMAIN_COLORS[challenge.domain];
  const domIcon = DOMAIN_ICONS[challenge.domain];

  const userGain = challenge.userEnd - challenge.userStart;
  const rivalGain = challenge.rivalEnd - challenge.rivalStart;
  const userGainStr = userGain >= 0 ? `+${userGain.toFixed(1)}` : userGain.toFixed(1);
  const rivalGainStr = rivalGain >= 0 ? `+${rivalGain.toFixed(1)}` : rivalGain.toFixed(1);

  const maxGain = Math.max(Math.abs(userGain), Math.abs(rivalGain), 1);
  const userBarPct = Math.min(100, (Math.abs(userGain) / maxGain) * 100);
  const rivalBarPct = Math.min(100, (Math.abs(rivalGain) / maxGain) * 100);

  return (
    <Modal transparent animationType="none" visible={visible} statusBarTranslucent>
      <Animated.View style={[styles.overlay, { opacity: overlayOpacity }]}>
        <LinearGradient
          colors={["#03050A", "#060308", "#03050A"]}
          style={StyleSheet.absoluteFill}
        />
        <LinearGradient
          colors={config.glowColors}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={StyleSheet.absoluteFill}
        />

        <View style={styles.inner}>
          {/* Header */}
          <Animated.View style={[styles.headerBlock, {
            opacity: headerOpacity,
            transform: [{ translateY: headerY }],
          }]}>
            <Text style={[styles.protocol, { color: config.color }]}>
              CHALLENGE COMPLETE // OUTCOME RECORDED
            </Text>
            <View style={styles.targetRow}>
              <Text style={[styles.domainIcon, { color: domColor }]}>{domIcon}</Text>
              <Text style={[styles.domainName, { color: domColor }]}>{challenge.domain}</Text>
              <Text style={styles.vsLabel}>vs</Text>
              <Text style={styles.rivalLabel}>{challenge.codename}</Text>
            </View>
            <View style={styles.dateRow}>
              <Feather name="calendar" size={10} color="#3A3D48" />
              <Text style={styles.dateText}>
                {challenge.startDate} → {challenge.endDate}
              </Text>
            </View>
          </Animated.View>

          {/* Outcome */}
          <Animated.View style={[styles.outcomeBlock, {
            opacity: outcomeOpacity,
            transform: [{ scale: outcomeScale }],
          }]}>
            <Feather name={config.icon} size={28} color={config.color} />
            <Text style={[styles.outcomeLabel, { color: config.color }]}>{config.label}</Text>
            <Text style={[styles.outcomeSub, { color: config.color }]}>{config.sub}</Text>
          </Animated.View>

          {/* Stats */}
          <Animated.View style={[styles.statsBlock, { opacity: statsOpacity }]}>
            <Text style={styles.statsTitle}>GAIN COMPARISON</Text>

            {/* User bar */}
            <View style={styles.statRow}>
              <Text style={styles.statWho}>YOU</Text>
              <View style={styles.statTrack}>
                <View style={[styles.statFill, {
                  width: `${userBarPct}%` as `${number}%`,
                  backgroundColor: challenge.outcome === "win" ? "#4B8B6F" : domColor,
                }]} />
              </View>
              <Text style={[styles.statVal, {
                color: challenge.outcome === "win" ? "#4B8B6F" : "#E05555",
              }]}>
                {userGainStr}
              </Text>
            </View>

            {/* Rival bar */}
            <View style={styles.statRow}>
              <Text style={styles.statWho}>RIVAL</Text>
              <View style={styles.statTrack}>
                <View style={[styles.statFill, {
                  width: `${rivalBarPct}%` as `${number}%`,
                  backgroundColor: challenge.outcome === "loss" ? "#E05555" : "#2A3040",
                }]} />
              </View>
              <Text style={[styles.statVal, {
                color: challenge.outcome === "loss" ? "#E05555" : "#4B8B6F",
              }]}>
                {rivalGainStr}
              </Text>
            </View>

            {/* Score summary */}
            <View style={[styles.scoreSummary, { borderColor: config.color + "30", backgroundColor: config.color + "08" }]}>
              <View style={styles.scorePair}>
                <Text style={styles.scoreLabel}>YOUR FINAL</Text>
                <Text style={[styles.scoreVal, { color: config.color }]}>
                  {challenge.userEnd.toFixed(1)}
                </Text>
              </View>
              <View style={[styles.scoreDivider, { backgroundColor: "#2A2D38" }]} />
              <View style={styles.scorePair}>
                <Text style={styles.scoreLabel}>RIVAL FINAL</Text>
                <Text style={[styles.scoreVal, { color: "#6B7280" }]}>
                  {challenge.rivalEnd.toFixed(1)}
                </Text>
              </View>
            </View>
          </Animated.View>

          {/* Button */}
          <Animated.View style={[styles.btnWrap, { opacity: btnOpacity }]}>
            <Pressable
              style={({ pressed }) => [styles.btn, {
                borderColor: config.color + "60",
                backgroundColor: config.color + "10",
                opacity: pressed ? 0.6 : 1,
              }]}
              onPress={onAcknowledge}
            >
              <Text style={[styles.btnText, { color: config.color }]}>RECORD ACKNOWLEDGED</Text>
            </Pressable>
          </Animated.View>
        </View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "#03050A" },
  inner: {
    flex: 1,
    paddingHorizontal: 28,
    paddingTop: 80,
    paddingBottom: 56,
    justifyContent: "center",
    gap: 36,
  },
  headerBlock: { gap: 12 },
  protocol: { fontSize: 8, letterSpacing: 3, fontWeight: "700" as const },
  targetRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  domainIcon: { fontSize: 14 },
  domainName: { fontSize: 13, fontWeight: "800" as const, letterSpacing: 2 },
  vsLabel: { fontSize: 10, color: "#2A2D38", letterSpacing: 1 },
  rivalLabel: { fontSize: 13, fontWeight: "600" as const, color: "#4A4D5A", letterSpacing: 0.3, flex: 1 },
  dateRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  dateText: { fontSize: 9, color: "#2A2D38", letterSpacing: 1 },
  outcomeBlock: { alignItems: "center", gap: 12 },
  outcomeLabel: { fontSize: 40, fontWeight: "900" as const, letterSpacing: 4, lineHeight: 46 },
  outcomeSub: { fontSize: 11, letterSpacing: 1, textAlign: "center", lineHeight: 17 },
  statsBlock: { gap: 14 },
  statsTitle: { fontSize: 8, letterSpacing: 3, color: "#2A2D38", fontWeight: "700" as const },
  statRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  statWho: { width: 40, fontSize: 8, letterSpacing: 2, color: "#3A3D48", fontWeight: "700" as const },
  statTrack: {
    flex: 1, height: 6, backgroundColor: "#0D1018",
    borderRadius: 3, overflow: "hidden",
  },
  statFill: { height: "100%", borderRadius: 3 },
  statVal: { width: 40, fontSize: 13, fontWeight: "800" as const, textAlign: "right" },
  scoreSummary: {
    flexDirection: "row", borderWidth: 1, borderRadius: 4,
    padding: 14, marginTop: 4,
  },
  scorePair: { flex: 1, alignItems: "center", gap: 4 },
  scoreLabel: { fontSize: 7, letterSpacing: 2, color: "#3A3D48", fontWeight: "700" as const },
  scoreVal: { fontSize: 22, fontWeight: "800" as const },
  scoreDivider: { width: StyleSheet.hairlineWidth, marginHorizontal: 8 },
  btnWrap: { alignItems: "center" },
  btn: {
    borderWidth: 1, borderRadius: 4,
    paddingVertical: 16, paddingHorizontal: 32,
  },
  btnText: { fontSize: 10, fontWeight: "800" as const, letterSpacing: 4 },
});
