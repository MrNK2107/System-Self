import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useApp, getStreakMultiplier, getStreakTier, type Domain } from "@/context/AppContext";
import { DOMAIN_COLORS, DOMAIN_ICONS } from "@/constants/domains";
import { BASE_LOG_DELTAS, FORBIDDEN_DISCIPLINE_DELTA, FORBIDDEN_DOMAIN_DELTA } from "@workspace/engine";

interface LogModalProps {
  visible: boolean;
  onClose: () => void;
}

type LogDomain = Domain;

interface LogConfig {
  domain: LogDomain;
  icon: string;
  color: string;
  types: { key: string; label: string }[];
}

const LOG_TYPES: Record<Domain, { key: string; label: string }[]> = {
  BODY: [
    { key: "workout", label: "Workout" },
    { key: "home_session", label: "Home Session" },
    { key: "sleep", label: "Sleep" },
    { key: "meal", label: "Meal" },
  ],
  MIND: [
    { key: "deep_work", label: "Deep Work" },
    { key: "reading", label: "Reading" },
    { key: "journal", label: "Journal" },
  ],
  WEALTH: [
    { key: "income", label: "Income" },
    { key: "expense", label: "Expense" },
    { key: "savings", label: "Savings" },
  ],
  SOCIAL: [
    { key: "conversation", label: "Conversation" },
    { key: "outreach", label: "Outreach" },
    { key: "gathering", label: "Gathering" },
  ],
  DISCIPLINE: [
    { key: "quest_complete", label: "Quest Done" },
    { key: "routine", label: "Routine" },
    { key: "habit", label: "Habit" },
  ],
};

const LOG_CONFIGS: LogConfig[] = (Object.keys(LOG_TYPES) as Domain[]).map((domain) => ({
  domain,
  icon: DOMAIN_ICONS[domain],
  color: DOMAIN_COLORS[domain],
  types: LOG_TYPES[domain],
}));

// Preview only: the server applies the real delta.
const BASE_DELTAS = BASE_LOG_DELTAS;
// Display copy for the forbidden-log trade (the server applies it).
const FORBIDDEN_GAIN = `+${FORBIDDEN_DOMAIN_DELTA}`;
const FORBIDDEN_PENALTY = `−${Math.abs(FORBIDDEN_DISCIPLINE_DELTA)}`;

const TIER_LABELS: Record<string, string> = {
  none: "NO STREAK", low: "BUILDING", mid: "ON STREAK",
  high: "HIGH STREAK", max: "MAX STREAK",
};

const TIER_COLORS: Record<string, string | null> = {
  none: null, low: "#6B7280", mid: null, high: null, max: "#D4B483",
};

export function LogModal({ visible, onClose }: LogModalProps) {
  const router = useRouter();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { addLog, domainScores } = useApp();

  const [selectedDomain, setSelectedDomain] = useState<LogDomain>("BODY");
  const [selectedType, setSelectedType] = useState("workout");
  const [note, setNote] = useState("");
  const [intensity, setIntensity] = useState(3);
  const [submitting, setSubmitting] = useState(false);
  const [isForbidden, setIsForbidden] = useState(false);
  const [showForbiddenWarning, setShowForbiddenWarning] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const config = LOG_CONFIGS.find(c => c.domain === selectedDomain)!;

  const domainScore = domainScores.find(s => s.domain === selectedDomain);
  const streak = domainScore?.streak ?? 0;
  const tier = getStreakTier(streak);
  const multiplier = getStreakMultiplier(streak);
  const baseDelta = isForbidden ? FORBIDDEN_DOMAIN_DELTA : BASE_DELTAS[selectedDomain];
  const bonusDelta = isForbidden ? FORBIDDEN_DOMAIN_DELTA : Math.round(baseDelta * multiplier * 10) / 10;
  const bonusGain = Math.round((bonusDelta - BASE_DELTAS[selectedDomain]) * 10) / 10;
  const tierColor = TIER_COLORS[tier] ?? config.color;

  const bannerOpacity = useRef(new Animated.Value(1)).current;
  const bannerTranslate = useRef(new Animated.Value(0)).current;
  const prevDomain = useRef(selectedDomain);
  const forbiddenFlash = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (prevDomain.current === selectedDomain) return;
    prevDomain.current = selectedDomain;
    bannerOpacity.setValue(0);
    bannerTranslate.setValue(6);
    Animated.parallel([
      Animated.timing(bannerOpacity, { toValue: 1, duration: 220, useNativeDriver: false }),
      Animated.timing(bannerTranslate, { toValue: 0, duration: 220, useNativeDriver: false }),
    ]).start();
  }, [selectedDomain]);

  const pulseOpacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (tier !== "high" && tier !== "max") {
      pulseOpacity.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseOpacity, { toValue: 0.4, duration: 700, useNativeDriver: false }),
        Animated.timing(pulseOpacity, { toValue: 1, duration: 700, useNativeDriver: false }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [tier, selectedDomain]);

  const handleDomainSelect = (domain: LogDomain, firstType: string) => {
    Haptics.selectionAsync();
    setSelectedDomain(domain);
    setSelectedType(firstType);
  };

  const handleToggleForbidden = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    if (!isForbidden) {
      setShowForbiddenWarning(true);
      // Flash red
      Animated.sequence([
        Animated.timing(forbiddenFlash, { toValue: 1, duration: 150, useNativeDriver: false }),
        Animated.timing(forbiddenFlash, { toValue: 0, duration: 400, useNativeDriver: false }),
      ]).start();
    }
    setIsForbidden(f => !f);
  };

  const handleSubmit = async () => {
    if (submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      // Queued in the outbox: it is kept on the device and sent when there is a connection.
      await addLog({ domain: selectedDomain, type: selectedType, forbidden: isForbidden, note, intensity });
    } catch {
      setSubmitError("The entry could not be recorded on this device. Sign in again, then retry.");
      setSubmitting(false);
      return;
    }

    setNote("");
    setIntensity(3);
    setIsForbidden(false);
    setShowForbiddenWarning(false);
    setSubmitting(false);
    onClose();
  };

  const forbiddenBg = forbiddenFlash.interpolate({
    inputRange: [0, 1],
    outputRange: ["transparent", "#9B000030"],
  });

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <Animated.View style={[
        styles.container,
        { backgroundColor: colors.background, paddingBottom: insets.bottom + 16 },
        isForbidden ? { backgroundColor: "#0A0203" } : {},
      ]}>
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: forbiddenBg }]} pointerEvents="none" />

        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Text style={[styles.title, { color: isForbidden ? "#9B0000" : colors.foreground }]}>
              {isForbidden ? "FORBIDDEN TRANSMISSION" : "LOG ENTRY"}
            </Text>
          </View>
          <TouchableOpacity onPress={onClose}>
            <Feather name="x" size={20} color={colors.mutedForeground} />
          </TouchableOpacity>
        </View>

        <ScrollView showsVerticalScrollIndicator={false}>
          {/* Forbidden mode toggle */}
          <TouchableOpacity
            style={[
              styles.forbiddenToggle,
              {
                borderColor: isForbidden ? "#9B000080" : colors.border,
                backgroundColor: isForbidden ? "#9B000015" : "transparent",
              },
            ]}
            onPress={handleToggleForbidden}
            activeOpacity={0.7}
          >
            <View style={styles.forbiddenLeft}>
              <Feather name="alert-triangle" size={13} color={isForbidden ? "#9B0000" : colors.mutedForeground} />
              <View>
                <Text style={[styles.forbiddenTitle, { color: isForbidden ? "#9B0000" : colors.mutedForeground }]}>
                  {isForbidden ? "FORBIDDEN MODE ACTIVE" : "FORBIDDEN LOG"}
                </Text>
                <Text style={[styles.forbiddenSub, { color: colors.mutedForeground }]}>
                  {isForbidden ? `${FORBIDDEN_GAIN} pts, ${FORBIDDEN_PENALTY} DISCIPLINE. Record is permanent.` : "High-risk, high-gain transmission"}
                </Text>
              </View>
            </View>
            <View style={[
              styles.forbiddenTogglePill,
              { backgroundColor: isForbidden ? "#9B0000" : colors.muted },
            ]}>
              <View style={[
                styles.forbiddenToggleDot,
                { marginLeft: isForbidden ? "auto" : 2, backgroundColor: "#fff" },
              ]} />
            </View>
          </TouchableOpacity>

          {/* Forbidden warning */}
          {showForbiddenWarning && isForbidden && (
            <View style={styles.forbiddenWarning}>
              <Text style={styles.forbiddenWarningText}>
                {`This entry is flagged as forbidden. It yields ${FORBIDDEN_GAIN} pts to the selected domain but ${FORBIDDEN_PENALTY} to DISCIPLINE. The record cannot be deleted.`}
              </Text>
            </View>
          )}

          {/* Domain selector */}
          <View style={styles.section}>
            <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>DOMAIN</Text>
            <View style={styles.domainGrid}>
              {LOG_CONFIGS.map(cfg => {
                const ds = domainScores.find(s => s.domain === cfg.domain);
                const dStreak = ds?.streak ?? 0;
                const dTier = getStreakTier(dStreak);
                const isSelected = selectedDomain === cfg.domain;
                const badgeColor = TIER_COLORS[dTier] ?? cfg.color;
                const activeColor = isForbidden ? "#9B0000" : cfg.color;

                return (
                  <TouchableOpacity
                    key={cfg.domain}
                    style={[
                      styles.domainBtn,
                      {
                        borderColor: isSelected ? activeColor : colors.border,
                        backgroundColor: isSelected ? activeColor + "20" : colors.card,
                      },
                    ]}
                    onPress={() => handleDomainSelect(cfg.domain, cfg.types[0]!.key)}
                    activeOpacity={0.7}
                  >
                    <View style={styles.domainBtnMain}>
                      <Feather
                        name={cfg.icon as "activity"}
                        size={16}
                        color={isSelected ? activeColor : colors.mutedForeground}
                      />
                      <Text style={[styles.domainLabel, { color: isSelected ? activeColor : colors.mutedForeground }]}>
                        {cfg.domain}
                      </Text>
                    </View>
                    {dTier !== "none" && (
                      <View style={[styles.domainStreakBadge, { backgroundColor: badgeColor + "20" }]}>
                        {(dTier === "mid" || dTier === "high" || dTier === "max") && (
                          <Feather name="zap" size={7} color={badgeColor} />
                        )}
                        <Text style={[styles.domainStreakText, { color: badgeColor }]}>
                          {dStreak}D
                        </Text>
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* Multiplier preview banner */}
          <Animated.View
            style={[
              styles.multiplierBanner,
              {
                borderColor: isForbidden ? "#9B000050" :
                  tier === "none" ? colors.border : tierColor + "50",
                backgroundColor: isForbidden ? "#9B000010" :
                  tier === "none" ? "transparent" : tierColor + "0E",
                opacity: bannerOpacity,
                transform: [{ translateY: bannerTranslate }],
                marginBottom: 24,
              },
            ]}
          >
            <View style={styles.multiplierLeft}>
              <Feather
                name={isForbidden ? "alert-triangle" : "zap"}
                size={13}
                color={isForbidden ? "#9B0000" : tierColor}
              />
              <View>
                <Text style={[
                  styles.multiplierMain,
                  { color: isForbidden ? "#9B0000" : tier === "none" ? colors.mutedForeground : tierColor },
                ]}>
                  {isForbidden
                    ? "FORBIDDEN  ·  RISK ACTIVE"
                    : tier === "none"
                    ? "NO STREAK  ·  BASE"
                    : `×${multiplier.toFixed(1)}  ·  ${streak}D  ·  ${TIER_LABELS[tier]}`
                  }
                </Text>
                <Text style={[styles.multiplierSub, { color: colors.mutedForeground }]}>
                  {isForbidden ? `${FORBIDDEN_PENALTY} DISCIPLINE penalty applied` : bonusGain > 0 ? `base ${baseDelta.toFixed(1)} pts  →  boosted` : ""}
                </Text>
              </View>
            </View>
            <View style={styles.multiplierRight}>
              <Text style={[
                styles.multiplierPts,
                { color: isForbidden ? "#9B0000" : tier === "none" ? colors.mutedForeground : tierColor },
              ]}>
                +{bonusDelta.toFixed(1)}
              </Text>
              <Text style={[styles.multiplierPtsLabel, { color: colors.mutedForeground }]}>pts</Text>
            </View>
          </Animated.View>

          {/* Type */}
          {selectedDomain === "BODY" && (
            <TouchableOpacity
              style={[styles.gymShortcut, { borderColor: colors.border, backgroundColor: colors.card }]}
              onPress={() => {
                onClose();
                router.push("/(tabs)/gym");
              }}
              activeOpacity={0.7}
            >
              <Feather name="activity" size={13} color={config.color} />
              <Text style={[styles.gymShortcutText, { color: colors.foreground }]}>
                Open Gym tracker for structured sets, PRs, and plan completion
              </Text>
            </TouchableOpacity>
          )}

          {/* Type */}
          <View style={styles.section}>
            <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>TYPE</Text>
            <View style={styles.typeRow}>
              {config.types.map(type => (
                <TouchableOpacity
                  key={type.key}
                  style={[
                    styles.typeBtn,
                    {
                      borderColor: selectedType === type.key
                        ? (isForbidden ? "#9B0000" : config.color)
                        : colors.border,
                      backgroundColor: selectedType === type.key
                        ? (isForbidden ? "#9B000020" : config.color + "20")
                        : "transparent",
                    },
                  ]}
                  onPress={() => setSelectedType(type.key)}
                  activeOpacity={0.7}
                >
                  <Text style={[
                    styles.typeLabel,
                    { color: selectedType === type.key
                        ? (isForbidden ? "#9B0000" : config.color)
                        : colors.mutedForeground },
                  ]}>
                    {type.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Intensity */}
          <View style={styles.section}>
            <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>INTENSITY</Text>
            <View style={styles.intensityRow}>
              {[1, 2, 3, 4, 5].map(i => (
                <TouchableOpacity
                  key={i}
                  style={[
                    styles.intensityBtn,
                    { backgroundColor: intensity >= i
                        ? (isForbidden ? "#9B0000" : config.color)
                        : colors.muted },
                  ]}
                  onPress={() => setIntensity(i)}
                  activeOpacity={0.7}
                />
              ))}
              <Text style={[styles.intensityLabel, { color: colors.mutedForeground }]}>
                {intensity}/5
              </Text>
            </View>
          </View>

          {/* Note */}
          <View style={styles.section}>
            <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
              {isForbidden ? "FORBIDDEN NOTE (REQUIRED)" : "NOTE (OPTIONAL)"}
            </Text>
            <TextInput
              style={[
                styles.input,
                {
                  color: isForbidden ? "#CC3333" : colors.foreground,
                  borderColor: isForbidden ? "#9B000060" : colors.border,
                  backgroundColor: isForbidden ? "#0A0102" : colors.card,
                },
              ]}
              placeholder={isForbidden
                ? "Document what you're transmitting. This record is permanent."
                : "What happened. Be specific."
              }
              placeholderTextColor={isForbidden ? "#660000" : colors.mutedForeground}
              value={note}
              onChangeText={setNote}
              multiline
              numberOfLines={3}
            />
          </View>
        </ScrollView>

        {submitError && (
          <Text style={[styles.submitError, { color: "#E05555" }]}>{submitError}</Text>
        )}

        {/* Submit */}
        <TouchableOpacity
          style={[styles.submitBtn, {
            backgroundColor: isForbidden ? "#6B0000" : config.color,
            borderWidth: isForbidden ? 1 : 0,
            borderColor: isForbidden ? "#9B0000" : "transparent",
          }]}
          onPress={handleSubmit}
          activeOpacity={0.8}
          disabled={submitting}
        >
          <Text style={styles.submitText}>
            {isForbidden ? "TRANSMIT FORBIDDEN" : "LOG IT"}
          </Text>
          <View style={styles.submitDivider} />
          <Text style={styles.submitPts}>
            {isForbidden
              ? `${FORBIDDEN_GAIN} pts / ${FORBIDDEN_PENALTY} DISC`
              : `+${bonusDelta.toFixed(1)} pts${tier !== "none" && tier !== "low" ? `  ×${multiplier.toFixed(1)}` : ""}`
            }
          </Text>
        </TouchableOpacity>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  submitError: { fontSize: 11, lineHeight: 16, marginBottom: 8, textAlign: "center" },
  container: { flex: 1, padding: 20 },
  header: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    marginBottom: 20, marginTop: 8,
  },
  headerLeft: { flex: 1 },
  title: { fontSize: 14, fontWeight: "700" as const, letterSpacing: 3 },
  section: { marginBottom: 24, gap: 10 },
  sectionLabel: { fontSize: 9, fontWeight: "600" as const, letterSpacing: 2 },
  forbiddenToggle: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    borderWidth: 1, borderRadius: 6, padding: 12, marginBottom: 12,
  },
  forbiddenLeft: { flexDirection: "row", alignItems: "flex-start", gap: 10, flex: 1 },
  forbiddenTitle: { fontSize: 10, fontWeight: "800" as const, letterSpacing: 2 },
  forbiddenSub: { fontSize: 9, marginTop: 2, letterSpacing: 0.5 },
  forbiddenTogglePill: {
    width: 38, height: 22, borderRadius: 11, padding: 2,
    flexDirection: "row", alignItems: "center",
  },
  forbiddenToggleDot: { width: 18, height: 18, borderRadius: 9 },
  forbiddenWarning: {
    borderWidth: 1, borderColor: "#9B000050", borderRadius: 4,
    padding: 10, marginBottom: 12, backgroundColor: "#9B000008",
  },
  forbiddenWarningText: { fontSize: 10, color: "#CC3333", lineHeight: 16, letterSpacing: 0.3 },
  gymShortcut: {
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
  },
  gymShortcutText: {
    fontSize: 10,
    letterSpacing: 0.4,
    flex: 1,
  },
  domainGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  domainBtn: { flex: 1, minWidth: "45%", padding: 12, borderWidth: 1, borderRadius: 4, gap: 8 },
  domainBtnMain: { flexDirection: "row", alignItems: "center", gap: 8 },
  domainLabel: { fontSize: 10, fontWeight: "700" as const, letterSpacing: 2 },
  domainStreakBadge: {
    flexDirection: "row", alignItems: "center", gap: 3, alignSelf: "flex-start",
    paddingHorizontal: 5, paddingVertical: 2, borderRadius: 2,
  },
  domainStreakText: { fontSize: 8, fontWeight: "700" as const, letterSpacing: 1 },
  multiplierBanner: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    borderWidth: 1, borderRadius: 4, paddingHorizontal: 14, paddingVertical: 12,
  },
  multiplierLeft: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1 },
  multiplierMain: { fontSize: 11, fontWeight: "700" as const, letterSpacing: 1.5 },
  multiplierSub: { fontSize: 9, letterSpacing: 0.5, marginTop: 2 },
  multiplierRight: { flexDirection: "row", alignItems: "baseline", gap: 3 },
  multiplierPts: { fontSize: 22, fontWeight: "800" as const, letterSpacing: -0.5 },
  multiplierPtsLabel: { fontSize: 10, fontWeight: "600" as const, letterSpacing: 1 },
  typeRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  typeBtn: { paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderRadius: 2 },
  typeLabel: { fontSize: 11, fontWeight: "600" as const },
  intensityRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  intensityBtn: { width: 32, height: 6, borderRadius: 1 },
  intensityLabel: { fontSize: 11, marginLeft: 4 },
  input: {
    borderWidth: 1, borderRadius: 4, padding: 12,
    fontSize: 13, minHeight: 80, textAlignVertical: "top",
  },
  submitBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    padding: 16, borderRadius: 2, marginTop: 8, gap: 12,
  },
  submitText: { color: "#FFFFFF", fontSize: 12, fontWeight: "700" as const, letterSpacing: 3 },
  submitDivider: { width: StyleSheet.hairlineWidth, height: 16, backgroundColor: "#FFFFFF40" },
  submitPts: { color: "#FFFFFF", fontSize: 12, fontWeight: "600" as const, letterSpacing: 1, opacity: 0.85 },
});
