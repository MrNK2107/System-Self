import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useApp, type Domain, type Rank } from "@/context/AppContext";
import { ALL_DOMAINS as DOMAINS, DOMAIN_COLORS, DOMAIN_GLYPHS as DOMAIN_ICONS } from "@/constants/domains";
import { RIVAL_CHALLENGE_DAYS } from "@workspace/contracts";

/** The rival as the challenge sheet shows it (all five ranked domains). */
export interface ChallengeTarget {
  codename: string;
  rank: Rank;
  trajectory: "up" | "stable" | "down";
  scores: Record<Domain, number>;
}

interface Props {
  visible: boolean;
  rival: ChallengeTarget | null;
  onClose: () => void;
  /** Sends the challenge; resolves null once the server confirmed it, else the reason it did not land. */
  onDeclare: (domain: Domain) => Promise<string | null>;
}

export function ChallengeModal({ visible, rival, onClose, onDeclare }: Props) {
  const colors = useColors();
  const { domainScores } = useApp();
  const [selectedDomain, setSelectedDomain] = useState<Domain>("DISCIPLINE");
  const [declared, setDeclared] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const overlayAnim = useRef(new Animated.Value(0)).current;
  const contentAnim = useRef(new Animated.Value(0)).current;
  const declaredAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      setDeclared(false);
      setSending(false);
      setError(null);
      setSelectedDomain("DISCIPLINE");
      overlayAnim.setValue(0);
      contentAnim.setValue(0);
      Animated.sequence([
        Animated.timing(overlayAnim, { toValue: 1, duration: 250, useNativeDriver: false }),
        Animated.timing(contentAnim, { toValue: 1, duration: 300, useNativeDriver: false }),
      ]).start();
    }
  }, [visible]);

  if (!rival) return null;

  const userScore = domainScores.find(s => s.domain === selectedDomain)?.score ?? 50;
  const rivalScore = rival.scores[selectedDomain] ?? 0;

  const diff = rivalScore - userScore;
  const userAhead = diff < 0;
  const domainColor = DOMAIN_COLORS[selectedDomain];

  const startDate = new Date();
  // The window is 7 local days including today.
  const endDate = new Date(Date.now() + (RIVAL_CHALLENGE_DAYS - 1) * 24 * 60 * 60 * 1000);
  const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });

  // The "declared" confirmation plays only after the server accepted the challenge; otherwise the error shows.
  const handleDeclare = async () => {
    if (sending) return;
    setSending(true);
    setError(null);
    const failure = await onDeclare(selectedDomain);
    setSending(false);
    if (failure !== null) {
      setError(failure);
      return;
    }
    setDeclared(true);
    declaredAnim.setValue(0);
    Animated.timing(declaredAnim, { toValue: 1, duration: 400, useNativeDriver: false }).start();
    setTimeout(onClose, 1200);
  };

  return (
    <Modal transparent animationType="none" visible={visible} statusBarTranslucent>
      <Animated.View style={[styles.overlay, { opacity: overlayAnim }]}>
        <LinearGradient
          colors={["#06080E", "#0A0C14", "#06080E"]}
          style={StyleSheet.absoluteFill}
        />

        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <Animated.View style={[styles.content, {
            opacity: contentAnim,
            transform: [{ translateY: contentAnim.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }],
          }]}>
            {/* Header */}
            <View style={styles.header}>
              <View>
                <Text style={styles.protocol}>CHALLENGE PROTOCOL // INITIATE</Text>
                <Text style={styles.title}>DECLARE{"\n"}CHALLENGE</Text>
              </View>
              <Pressable onPress={onClose} style={styles.closeBtn}>
                <Feather name="x" size={18} color="#3A3D4A" />
              </Pressable>
            </View>

            {/* Target rival */}
            <View style={[styles.rivalCard, { borderColor: "#2A2D3A", backgroundColor: "#0D101A" }]}>
              <Text style={styles.targetLabel}>TARGET ENTITY</Text>
              <View style={styles.rivalRow}>
                <View style={styles.rivalLeft}>
                  <Text style={styles.rivalCodename}>{rival.codename}</Text>
                  <View style={styles.rivalMeta}>
                    <View style={[styles.rankBox, { borderColor: colors.border }]}>
                      <Text style={[styles.rankText, { color: colors.foreground }]}>{rival.rank}</Text>
                    </View>
                    <Text style={[styles.trajText, {
                      color: rival.trajectory === "up" ? "#E05555" :
                        rival.trajectory === "down" ? "#4B8B6F" : colors.mutedForeground,
                    }]}>
                      {rival.trajectory === "up" ? "↑ ASCENDING" :
                        rival.trajectory === "down" ? "↓ DECLINING" : "→ STABLE"}
                    </Text>
                  </View>
                </View>
              </View>
            </View>

            {/* Domain selector */}
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>SELECT DOMAIN</Text>
              <View style={styles.domainGrid}>
                {DOMAINS.map(d => {
                  const color = DOMAIN_COLORS[d];
                  const sel = selectedDomain === d;
                  return (
                    <Pressable
                      key={d}
                      style={[styles.domainBtn, {
                        borderColor: sel ? color : "#1A1D28",
                        backgroundColor: sel ? color + "14" : "#0D101A",
                      }]}
                      onPress={() => setSelectedDomain(d)}
                    >
                      <Text style={[styles.domainIcon, { color }]}>{DOMAIN_ICONS[d]}</Text>
                      <Text style={[styles.domainLabel, { color: sel ? color : "#3A3D4A" }]}>{d}</Text>
                      {sel && <View style={[styles.selDot, { backgroundColor: color }]} />}
                    </Pressable>
                  );
                })}
              </View>
            </View>

            {/* Score comparison */}
            <View style={[styles.compareCard, {
              borderColor: domainColor + "30",
              backgroundColor: domainColor + "08",
            }]}>
              <Text style={[styles.compareTitle, { color: domainColor }]}>
                {DOMAIN_ICONS[selectedDomain]} {selectedDomain} MATCHUP
              </Text>
              <View style={styles.compareRow}>
                <View style={styles.compareCol}>
                  <Text style={styles.compareWho}>YOU</Text>
                  <Text style={[styles.compareScore, { color: colors.foreground }]}>
                    {userScore.toFixed(1)}
                  </Text>
                </View>
                <View style={styles.compareVs}>
                  <Text style={styles.vsText}>VS</Text>
                  <Text style={[styles.diffBadge, { color: userAhead ? "#4B8B6F" : "#E05555" }]}>
                    {userAhead
                      ? `YOU +${Math.abs(diff).toFixed(1)}`
                      : `RIVAL +${diff.toFixed(1)}`}
                  </Text>
                </View>
                <View style={styles.compareCol}>
                  <Text style={styles.compareWho}>RIVAL</Text>
                  <Text style={[styles.compareScore, { color: colors.foreground }]}>
                    {rivalScore.toFixed(1)}
                  </Text>
                </View>
              </View>

              {/* Bar */}
              <View style={styles.barWrap}>
                <View style={[styles.barTrack, { backgroundColor: "#0D101A" }]}>
                  <View style={[styles.barFill, {
                    width: `${Math.min(100, userScore)}%` as `${number}%`,
                    backgroundColor: domainColor,
                  }]} />
                  <View style={[styles.rivalMarker, {
                    left: `${Math.min(100, rivalScore)}%` as `${number}%`,
                    backgroundColor: "#E05555",
                  }]} />
                </View>
                <View style={styles.barLabels}>
                  <Text style={styles.barLabelLeft}>0</Text>
                  <Text style={styles.barLabelRight}>100</Text>
                </View>
              </View>
            </View>

            {/* Timeline */}
            <View style={[styles.timelineCard, { borderColor: colors.border, backgroundColor: colors.card }]}>
              <View style={styles.timelineRow}>
                <Feather name="clock" size={11} color={colors.mutedForeground} />
                <Text style={[styles.timelineLabel, { color: colors.mutedForeground }]}>7-DAY WINDOW</Text>
              </View>
              <View style={styles.dateLine}>
                <Text style={[styles.dateText, { color: colors.foreground }]}>{fmt(startDate)}</Text>
                <View style={styles.dateArrow}>
                  <View style={[styles.dashedLine, { borderColor: colors.border }]} />
                  <Feather name="arrow-right" size={11} color={colors.mutedForeground} />
                </View>
                <Text style={[styles.dateText, { color: colors.foreground }]}>{fmt(endDate)}</Text>
              </View>
              <Text style={[styles.winCond, { color: colors.mutedForeground }]}>
                Win condition: gain more {selectedDomain} points than the rival over 7 days.
              </Text>
            </View>

            {/* Declare / confirmed */}
            {!declared ? (
              <View style={styles.btnRow}>
                <Pressable
                  style={({ pressed }) => [styles.declareBtn, {
                    borderColor: domainColor,
                    backgroundColor: domainColor + "18",
                    opacity: pressed ? 0.6 : 1,
                  }]}
                  onPress={() => void handleDeclare()}
                  disabled={sending}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: sending, busy: sending }}
                >
                  <Text style={[styles.declareBtnText, { color: domainColor }]}>
                    {sending ? "TRANSMITTING" : "DECLARE CHALLENGE"}
                  </Text>
                </Pressable>
                {error ? <Text style={styles.errorText} accessibilityRole="alert">{error}</Text> : null}
                <Pressable onPress={onClose} style={styles.cancelBtn}>
                  <Text style={[styles.cancelText, { color: colors.mutedForeground }]}>CANCEL</Text>
                </Pressable>
              </View>
            ) : (
              <Animated.View style={[styles.confirmedBlock, { opacity: declaredAnim }]}>
                <Feather name="check-circle" size={22} color={domainColor} />
                <Text style={[styles.confirmedText, { color: domainColor }]}>CHALLENGE DECLARED</Text>
                <Text style={[styles.confirmedSub, { color: colors.mutedForeground }]}>
                  The system is watching.
                </Text>
              </Animated.View>
            )}
          </Animated.View>
        </ScrollView>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "#06080E" },
  scroll: { paddingHorizontal: 24, paddingTop: 72, paddingBottom: 56 },
  content: { gap: 20 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 4,
  },
  protocol: { fontSize: 8, letterSpacing: 3, color: "#3A7BD5", fontWeight: "700" as const, marginBottom: 8 },
  title: { fontSize: 26, fontWeight: "800" as const, color: "#C8CBD8", letterSpacing: 1, lineHeight: 32 },
  closeBtn: { padding: 8 },
  rivalCard: { padding: 16, borderWidth: 1, borderRadius: 6, gap: 10 },
  targetLabel: { fontSize: 8, letterSpacing: 3, color: "#2A4060", fontWeight: "700" as const },
  rivalRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  rivalLeft: { gap: 8 },
  rivalCodename: { fontSize: 16, fontWeight: "700" as const, color: "#C8CBD8", letterSpacing: 0.5 },
  rivalMeta: { flexDirection: "row", alignItems: "center", gap: 10 },
  rankBox: {
    borderWidth: 1, width: 28, height: 28,
    alignItems: "center", justifyContent: "center", borderRadius: 2,
  },
  rankText: { fontSize: 12, fontWeight: "800" as const },
  trajText: { fontSize: 10, fontWeight: "600" as const, letterSpacing: 1 },
  section: { gap: 10 },
  sectionLabel: { fontSize: 8, letterSpacing: 3, color: "#3A3D4A", fontWeight: "700" as const },
  domainGrid: { flexDirection: "row", gap: 8 },
  domainBtn: {
    flex: 1, paddingVertical: 14,
    borderWidth: 1, borderRadius: 4,
    alignItems: "center", gap: 5, position: "relative",
  },
  domainIcon: { fontSize: 14 },
  domainLabel: { fontSize: 8, letterSpacing: 2, fontWeight: "800" as const },
  selDot: { width: 4, height: 4, borderRadius: 2 },
  compareCard: { padding: 16, borderWidth: 1, borderRadius: 6, gap: 14 },
  compareTitle: { fontSize: 9, letterSpacing: 2.5, fontWeight: "800" as const },
  compareRow: { flexDirection: "row", alignItems: "center" },
  compareCol: { flex: 1, alignItems: "center", gap: 4 },
  compareWho: { fontSize: 8, letterSpacing: 2, color: "#3A3D4A", fontWeight: "700" as const },
  compareScore: { fontSize: 28, fontWeight: "800" as const, letterSpacing: -1 },
  compareVs: { alignItems: "center", gap: 4, paddingHorizontal: 12 },
  vsText: { fontSize: 9, letterSpacing: 2, color: "#2A2D38", fontWeight: "700" as const },
  diffBadge: { fontSize: 9, fontWeight: "800" as const, letterSpacing: 1 },
  barWrap: { gap: 4 },
  barTrack: { height: 6, borderRadius: 3, overflow: "visible", position: "relative" },
  barFill: { position: "absolute", left: 0, top: 0, height: "100%", borderRadius: 3 },
  rivalMarker: {
    position: "absolute", top: -4, width: 2, height: 14,
    borderRadius: 1, marginLeft: -1,
  },
  barLabels: { flexDirection: "row", justifyContent: "space-between" },
  barLabelLeft: { fontSize: 8, color: "#2A2D38" },
  barLabelRight: { fontSize: 8, color: "#2A2D38" },
  timelineCard: { padding: 14, borderWidth: 1, borderRadius: 6, gap: 10 },
  timelineRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  timelineLabel: { fontSize: 8, letterSpacing: 2.5, fontWeight: "700" as const },
  dateLine: { flexDirection: "row", alignItems: "center", gap: 10 },
  dateText: { fontSize: 14, fontWeight: "700" as const },
  dateArrow: { flex: 1, flexDirection: "row", alignItems: "center", gap: 4 },
  dashedLine: { flex: 1, height: 1, borderWidth: StyleSheet.hairlineWidth, borderStyle: "dashed" },
  winCond: { fontSize: 10, lineHeight: 16 },
  btnRow: { gap: 10, marginTop: 4 },
  declareBtn: {
    borderWidth: 1, borderRadius: 4,
    paddingVertical: 16, alignItems: "center",
  },
  declareBtnText: { fontSize: 11, fontWeight: "800" as const, letterSpacing: 3 },
  errorText: { fontSize: 11, lineHeight: 16, color: "#E05555", textAlign: "center" },
  cancelBtn: { alignItems: "center", paddingVertical: 10 },
  cancelText: { fontSize: 10, letterSpacing: 2, fontWeight: "600" as const },
  confirmedBlock: { alignItems: "center", gap: 10, paddingVertical: 20 },
  confirmedText: { fontSize: 13, fontWeight: "800" as const, letterSpacing: 3 },
  confirmedSub: { fontSize: 10, letterSpacing: 1 },
});
