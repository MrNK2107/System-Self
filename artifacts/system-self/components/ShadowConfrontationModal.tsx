import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  Dimensions,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Feather } from "@expo/vector-icons";
import { scoreRecord, useApp, type Domain } from "@/context/AppContext";
import { useSystemAI } from "@/hooks/useSystemAI";
import { ALL_DOMAINS as DOMAINS, DOMAIN_COLORS, DOMAIN_GLYPHS as DOMAIN_ICONS } from "@/constants/domains";

const { width: SW } = Dimensions.get("window");

interface Props {
  visible: boolean;
  onClose: () => void;
}

function useAnimatedSequence(visible: boolean, count: number) {
  const headerOpacity = useRef(new Animated.Value(0)).current;
  const headerY = useRef(new Animated.Value(-12)).current;
  const overlayOpacity = useRef(new Animated.Value(0)).current;
  const dividerWidth = useRef(new Animated.Value(0)).current;
  const gapScale = useRef(new Animated.Value(1.6)).current;
  const gapOpacity = useRef(new Animated.Value(0)).current;
  const aiOpacity = useRef(new Animated.Value(0)).current;
  const btnOpacity = useRef(new Animated.Value(0)).current;

  const rowOpacity = useRef(DOMAINS.map(() => new Animated.Value(0))).current;
  const youWidth = useRef(DOMAINS.map(() => new Animated.Value(0))).current;
  const shadowWidth = useRef(DOMAINS.map(() => new Animated.Value(0))).current;
  const deltaOpacity = useRef(DOMAINS.map(() => new Animated.Value(0))).current;

  useEffect(() => {
    if (!visible) return;

    // Reset all
    overlayOpacity.setValue(0);
    headerOpacity.setValue(0);
    headerY.setValue(-12);
    dividerWidth.setValue(0);
    gapScale.setValue(1.6);
    gapOpacity.setValue(0);
    aiOpacity.setValue(0);
    btnOpacity.setValue(0);
    rowOpacity.forEach(a => a.setValue(0));
    youWidth.forEach(a => a.setValue(0));
    shadowWidth.forEach(a => a.setValue(0));
    deltaOpacity.forEach(a => a.setValue(0));

    const timers: ReturnType<typeof setTimeout>[] = [];

    // Overlay
    Animated.timing(overlayOpacity, { toValue: 1, duration: 400, useNativeDriver: false }).start();

    // Header
    timers.push(setTimeout(() => {
      Animated.parallel([
        Animated.timing(headerOpacity, { toValue: 1, duration: 350, useNativeDriver: false }),
        Animated.timing(headerY, { toValue: 0, duration: 350, useNativeDriver: false }),
      ]).start();
    }, 400));

    // Domain rows stagger
    const ROW_INTERVAL = 380;
    const ROW_START = 750;
    DOMAINS.forEach((_, i) => {
      const t = ROW_START + i * ROW_INTERVAL;
      timers.push(setTimeout(() => {
        Animated.timing(rowOpacity[i]!, { toValue: 1, duration: 250, useNativeDriver: false }).start();
      }, t));
      timers.push(setTimeout(() => {
        Animated.timing(youWidth[i]!, { toValue: 1, duration: 700, useNativeDriver: false }).start();
      }, t + 80));
      timers.push(setTimeout(() => {
        Animated.timing(shadowWidth[i]!, { toValue: 1, duration: 700, useNativeDriver: false }).start();
      }, t + 200));
      timers.push(setTimeout(() => {
        Animated.timing(deltaOpacity[i]!, { toValue: 1, duration: 300, useNativeDriver: false }).start();
      }, t + 750));
    });

    const afterRows = ROW_START + DOMAINS.length * ROW_INTERVAL + 400;

    // Divider
    timers.push(setTimeout(() => {
      Animated.timing(dividerWidth, { toValue: SW - 48, duration: 400, useNativeDriver: false }).start();
    }, afterRows));

    // Gap number
    timers.push(setTimeout(() => {
      Animated.parallel([
        Animated.timing(gapOpacity, { toValue: 1, duration: 300, useNativeDriver: false }),
        Animated.spring(gapScale, { toValue: 1, friction: 5, tension: 80, useNativeDriver: false }),
      ]).start();
    }, afterRows + 350));

    // AI text
    timers.push(setTimeout(() => {
      Animated.timing(aiOpacity, { toValue: 1, duration: 300, useNativeDriver: false }).start();
    }, afterRows + 700));

    // Button
    timers.push(setTimeout(() => {
      Animated.timing(btnOpacity, { toValue: 1, duration: 500, useNativeDriver: false }).start();
    }, afterRows + 2200));

    return () => timers.forEach(clearTimeout);
  }, [visible]);

  return {
    overlayOpacity, headerOpacity, headerY,
    rowOpacity, youWidth, shadowWidth, deltaOpacity,
    dividerWidth, gapScale, gapOpacity, aiOpacity, btnOpacity,
  };
}

export function ShadowConfrontationModal({ visible, onClose }: Props) {
  const { user, domainScores, shadowSelf, getShadowScores, getShadowRank, trajectory, quests } = useApp();
  const { generateMessage } = useSystemAI();

  const shadowScores = getShadowScores();
  const shadowRank = getShadowRank();

  const userScoreMap: Record<Domain, number> = scoreRecord(domainScores);

  const domainDeltas = DOMAINS.map(d => ({
    domain: d,
    you: userScoreMap[d],
    shadow: shadowScores[d],
    diff: shadowScores[d] - userScoreMap[d],
  }));

  const totalGap = domainDeltas.reduce((s, d) => s + d.diff, 0) / DOMAINS.length;
  const shadowLeads = totalGap > 0;

  const [aiText, setAiText] = useState("");
  const [aiLoaded, setAiLoaded] = useState(false);
  const [displayed, setDisplayed] = useState("");

  const anim = useAnimatedSequence(visible, DOMAINS.length);

  // Fetch AI on open
  useEffect(() => {
    if (!visible || aiLoaded || !user) return;
    setAiText("");
    setAiLoaded(false);
    let cancelled = false;
    generateMessage("shadow_confrontation").then(text => {
      if (cancelled) return;
      setAiText(text);
      setAiLoaded(true);
    });
    return () => { cancelled = true; };
  }, [visible]);

  // Reset AI state when closed
  useEffect(() => {
    if (!visible) {
      setAiLoaded(false);
      setAiText("");
      setDisplayed("");
    }
  }, [visible]);

  // Typewriter
  useEffect(() => {
    if (!aiText) return;
    setDisplayed("");
    let i = 0;
    const delay = Math.min(40, 2000 / Math.max(aiText.length, 1));
    const interval = setInterval(() => {
      i++;
      setDisplayed(aiText.slice(0, i));
      if (i >= aiText.length) clearInterval(interval);
    }, delay);
    return () => clearInterval(interval);
  }, [aiText]);

  if (!visible) return null;

  return (
    <Modal transparent animationType="none" visible={visible} statusBarTranslucent>
      <Animated.View style={[styles.overlay, { opacity: anim.overlayOpacity }]}>
        <LinearGradient
          colors={["#03050A", "#06030A", "#03050A"]}
          style={StyleSheet.absoluteFill}
        />
        <LinearGradient
          colors={["#E0555510", "transparent", "#E0555506"]}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        {/* Grid lines */}
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          {Array.from({ length: Math.ceil(SW / 44) + 1 }).map((_, i) => (
            <View key={i} style={[styles.gridV, { left: i * 44 }]} />
          ))}
        </View>

        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <Animated.View style={[
            styles.headerBlock,
            { opacity: anim.headerOpacity, transform: [{ translateY: anim.headerY }] },
          ]}>
            <Text style={styles.protocol}>CONFRONTATION PROTOCOL // ACTIVE</Text>
            <View style={styles.headerMain}>
              <View>
                <Text style={styles.entityLabel}>SHADOW ENTITY</Text>
                <Text style={styles.codename}>{shadowSelf.codename}</Text>
              </View>
              <View style={styles.rankBox}>
                <Text style={styles.rankLetter}>{shadowRank}</Text>
              </View>
            </View>
            <View style={styles.statusRow}>
              <View style={[styles.statusDot, { backgroundColor: shadowLeads ? "#E05555" : "#4B8B6F" }]} />
              <Text style={[styles.statusText, { color: shadowLeads ? "#E05555" : "#4B8B6F" }]}>
                {shadowLeads
                  ? `SHADOW LEADS — ${Math.abs(totalGap).toFixed(1)} PTS AHEAD`
                  : `YOU LEAD — ${Math.abs(totalGap).toFixed(1)} PTS AHEAD`}
              </Text>
            </View>
          </Animated.View>

          {/* Thin divider */}
          <View style={[styles.thinLine, { backgroundColor: "#1A1D28" }]} />

          {/* Domain battle rows */}
          <View style={styles.domainsBlock}>
            {domainDeltas.map((d, i) => {
              const color = DOMAIN_COLORS[d.domain];
              const shadowAhead = d.diff > 0;
              const youPct = Math.min(100, d.you);
              const shadowPct = Math.min(100, d.shadow);
              const youBarW = anim.youWidth[i]!.interpolate({
                inputRange: [0, 1],
                outputRange: ["0%", `${youPct}%`],
              });
              const shadowBarW = anim.shadowWidth[i]!.interpolate({
                inputRange: [0, 1],
                outputRange: ["0%", `${shadowPct}%`],
              });

              return (
                <Animated.View key={d.domain} style={[styles.domainBattle, { opacity: anim.rowOpacity[i] }]}>
                  {/* Domain label row */}
                  <View style={styles.domainLabelRow}>
                    <Text style={[styles.domainIcon, { color }]}>{DOMAIN_ICONS[d.domain]}</Text>
                    <Text style={[styles.domainName, { color }]}>{d.domain}</Text>
                    <Animated.View style={[styles.deltaWrap, { opacity: anim.deltaOpacity[i] }]}>
                      <Text style={[
                        styles.deltaText,
                        { color: shadowAhead ? "#E05555" : "#4B8B6F" },
                      ]}>
                        {shadowAhead
                          ? `SHADOW +${d.diff.toFixed(1)}`
                          : `YOU +${Math.abs(d.diff).toFixed(1)}`}
                      </Text>
                    </Animated.View>
                  </View>

                  {/* YOU track */}
                  <View style={styles.trackRow}>
                    <Text style={styles.trackLabel}>YOU</Text>
                    <View style={styles.track}>
                      <Animated.View style={[styles.trackFill, { width: youBarW, backgroundColor: color }]} />
                    </View>
                    <Text style={[styles.trackScore, { color }]}>{d.you.toFixed(1)}</Text>
                  </View>

                  {/* SHADOW track */}
                  <View style={styles.trackRow}>
                    <Text style={styles.trackLabel}>SHADOW</Text>
                    <View style={styles.track}>
                      <Animated.View style={[
                        styles.trackFill,
                        {
                          width: shadowBarW,
                          backgroundColor: shadowAhead ? "#E05555" : "#2A3A2E",
                        },
                      ]} />
                      {/* Creeping marker */}
                      <Animated.View style={[
                        styles.creepMarker,
                        {
                          left: shadowBarW,
                          backgroundColor: shadowAhead ? "#E05555" : "#4B8B6F",
                          opacity: shadowAhead ? 1 : 0.5,
                        },
                      ]} />
                    </View>
                    <Text style={[
                      styles.trackScore,
                      { color: shadowAhead ? "#E05555" : "#6B7280" },
                    ]}>
                      {d.shadow.toFixed(1)}
                    </Text>
                  </View>
                </Animated.View>
              );
            })}
          </View>

          {/* Divider */}
          <Animated.View style={[styles.divider, { width: anim.dividerWidth }]} />

          {/* Gap */}
          <Animated.View style={[
            styles.gapBlock,
            { opacity: anim.gapOpacity, transform: [{ scale: anim.gapScale }] },
          ]}>
            <Text style={[styles.gapLabel, { color: shadowLeads ? "#E05555" : "#4B8B6F" }]}>
              {shadowLeads ? "SHADOW LEADS" : "YOU LEAD"}
            </Text>
            <Text style={[styles.gapNumber, { color: shadowLeads ? "#E05555" : "#4B8B6F" }]}>
              {Math.abs(totalGap).toFixed(2)}
            </Text>
            <Text style={[styles.gapUnit, { color: shadowLeads ? "#E05555" : "#4B8B6F" }]}>PTS</Text>
          </Animated.View>

          {/* AI text */}
          <Animated.View style={[styles.aiBlock, { opacity: anim.aiOpacity }]}>
            <View style={styles.aiSpeaker}>
              <View style={[styles.speakerDot, { backgroundColor: shadowLeads ? "#E05555" : "#4B8B6F" }]} />
              <Text style={[styles.speakerLabel, { color: shadowLeads ? "#E05555" : "#4B8B6F" }]}>
                {shadowLeads ? shadowSelf.codename : "THE SYSTEM"}
              </Text>
            </View>
            {!aiLoaded ? (
              <Text style={styles.aiLoading}>Generating transmission...</Text>
            ) : (
              <Text style={styles.aiText}>
                {displayed}
                {displayed.length < aiText.length && (
                  <Text style={[styles.cursor, { color: shadowLeads ? "#E05555" : "#4B8B6F" }]}>█</Text>
                )}
              </Text>
            )}
          </Animated.View>

          {/* Close button */}
          <Animated.View style={[styles.btnWrap, { opacity: anim.btnOpacity }]}>
            <Pressable
              style={({ pressed }) => [styles.btn, { opacity: pressed ? 0.5 : 1 }]}
              onPress={onClose}
            >
              <Text style={styles.btnText}>CLOSE CONFRONTATION</Text>
            </Pressable>
          </Animated.View>
        </ScrollView>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "#03050A",
  },
  scroll: {
    paddingHorizontal: 24,
    paddingTop: 72,
    paddingBottom: 56,
    gap: 0,
  },
  gridV: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: StyleSheet.hairlineWidth,
    backgroundColor: "#E05555",
    opacity: 0.018,
  },

  // Header
  headerBlock: {
    gap: 14,
    marginBottom: 24,
  },
  protocol: {
    fontSize: 8,
    letterSpacing: 3,
    color: "#E05555",
    fontWeight: "700" as const,
  },
  headerMain: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  entityLabel: {
    fontSize: 8,
    letterSpacing: 3,
    color: "#3A1010",
    fontWeight: "700" as const,
    marginBottom: 4,
  },
  codename: {
    fontSize: 22,
    fontWeight: "800" as const,
    color: "#C8CBD8",
    letterSpacing: 1,
  },
  rankBox: {
    width: 44,
    height: 44,
    borderWidth: 1,
    borderColor: "#E0555540",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0A030A",
  },
  rankLetter: {
    fontSize: 22,
    fontWeight: "900" as const,
    color: "#E05555",
    letterSpacing: 2,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusText: {
    fontSize: 10,
    fontWeight: "700" as const,
    letterSpacing: 2,
  },

  thinLine: {
    height: StyleSheet.hairlineWidth,
    marginBottom: 24,
  },

  // Domain battles
  domainsBlock: {
    gap: 22,
    marginBottom: 24,
  },
  domainBattle: {
    gap: 7,
  },
  domainLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 2,
  },
  domainIcon: {
    fontSize: 10,
  },
  domainName: {
    fontSize: 9,
    fontWeight: "800" as const,
    letterSpacing: 2.5,
    flex: 1,
  },
  deltaWrap: {},
  deltaText: {
    fontSize: 9,
    fontWeight: "700" as const,
    letterSpacing: 1,
  },
  trackRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  trackLabel: {
    width: 48,
    fontSize: 7,
    fontWeight: "700" as const,
    letterSpacing: 1.5,
    color: "#3A3D4A",
    textAlign: "right",
  },
  track: {
    flex: 1,
    height: 5,
    backgroundColor: "#0D1018",
    borderRadius: 2,
    overflow: "visible",
    position: "relative",
  },
  trackFill: {
    position: "absolute",
    left: 0,
    top: 0,
    height: "100%",
    borderRadius: 2,
  },
  creepMarker: {
    position: "absolute",
    top: -4,
    width: 2,
    height: 13,
    borderRadius: 1,
    marginLeft: -1,
  },
  trackScore: {
    width: 36,
    fontSize: 11,
    fontWeight: "700" as const,
    textAlign: "right",
    letterSpacing: 0.5,
  },

  // Divider
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: "#1A1D28",
    marginBottom: 24,
  },

  // Gap
  gapBlock: {
    alignItems: "center",
    marginBottom: 28,
    gap: 4,
  },
  gapLabel: {
    fontSize: 9,
    fontWeight: "700" as const,
    letterSpacing: 5,
  },
  gapNumber: {
    fontSize: 56,
    fontWeight: "800" as const,
    letterSpacing: -2,
    lineHeight: 64,
  },
  gapUnit: {
    fontSize: 11,
    fontWeight: "700" as const,
    letterSpacing: 4,
    marginTop: -4,
  },

  // AI text
  aiBlock: {
    gap: 12,
    marginBottom: 36,
  },
  aiSpeaker: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  speakerDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
  speakerLabel: {
    fontSize: 8,
    fontWeight: "700" as const,
    letterSpacing: 2,
  },
  aiLoading: {
    fontSize: 11,
    color: "#2A2D38",
    letterSpacing: 1,
  },
  aiText: {
    fontSize: 14,
    lineHeight: 23,
    color: "#9A9DAA",
    fontWeight: "400" as const,
  },
  cursor: {
    fontSize: 14,
  },

  // Button
  btnWrap: {
    alignItems: "center",
  },
  btn: {
    borderWidth: 1,
    borderColor: "#1A1D28",
    borderRadius: 2,
    paddingVertical: 14,
    paddingHorizontal: 32,
  },
  btnText: {
    fontSize: 10,
    fontWeight: "700" as const,
    letterSpacing: 4,
    color: "#3A3D4A",
  },
});
