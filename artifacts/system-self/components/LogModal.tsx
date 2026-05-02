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
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useApp, getStreakMultiplier, getStreakTier, type Domain } from "@/context/AppContext";

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

const LOG_CONFIGS: LogConfig[] = [
  {
    domain: "BODY",
    icon: "activity",
    color: "#E05555",
    types: [
      { key: "workout", label: "Workout" },
      { key: "sleep", label: "Sleep" },
      { key: "meal", label: "Meal" },
    ],
  },
  {
    domain: "MIND",
    icon: "book",
    color: "#3A7BD5",
    types: [
      { key: "deep_work", label: "Deep Work" },
      { key: "reading", label: "Reading" },
      { key: "journal", label: "Journal" },
    ],
  },
  {
    domain: "WEALTH",
    icon: "trending-up",
    color: "#4B8B6F",
    types: [
      { key: "income", label: "Income" },
      { key: "expense", label: "Expense" },
      { key: "savings", label: "Savings" },
    ],
  },
  {
    domain: "DISCIPLINE",
    icon: "zap",
    color: "#C4873A",
    types: [
      { key: "quest_complete", label: "Quest Done" },
      { key: "routine", label: "Routine" },
      { key: "habit", label: "Habit" },
    ],
  },
];

const BASE_DELTAS: Record<Domain, number> = {
  BODY: 2.5,
  MIND: 2.5,
  WEALTH: 2.0,
  DISCIPLINE: 3.0,
};

const TIER_LABELS: Record<string, string> = {
  none: "NO STREAK",
  low: "BUILDING",
  mid: "ON STREAK",
  high: "HIGH STREAK",
  max: "MAX STREAK",
};

const TIER_COLORS: Record<string, string | null> = {
  none: null,
  low: "#6B7280",
  mid: null, // domain color
  high: null, // domain color
  max: "#D4B483",
};

export function LogModal({ visible, onClose }: LogModalProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { addLog, domainScores } = useApp();

  const [selectedDomain, setSelectedDomain] = useState<LogDomain>("BODY");
  const [selectedType, setSelectedType] = useState("workout");
  const [note, setNote] = useState("");
  const [intensity, setIntensity] = useState(3);
  const [submitting, setSubmitting] = useState(false);

  const config = LOG_CONFIGS.find(c => c.domain === selectedDomain)!;

  // Streak data for selected domain
  const domainScore = domainScores.find(s => s.domain === selectedDomain);
  const streak = domainScore?.streak ?? 0;
  const tier = getStreakTier(streak);
  const multiplier = getStreakMultiplier(streak);
  const baseDelta = BASE_DELTAS[selectedDomain];
  const bonusDelta = Math.round(baseDelta * multiplier * 10) / 10;
  const bonusGain = Math.round((bonusDelta - baseDelta) * 10) / 10;
  const tierColor = TIER_COLORS[tier] ?? config.color;

  // Animate the preview banner on domain change
  const bannerOpacity = useRef(new Animated.Value(1)).current;
  const bannerTranslate = useRef(new Animated.Value(0)).current;

  const prevDomain = useRef(selectedDomain);

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

  // Pulse animation for high/max streak indicator
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

  const handleSubmit = async () => {
    if (submitting) return;
    setSubmitting(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    await addLog({
      domain: selectedDomain,
      type: selectedType,
      data: { note, intensity },
    });

    setNote("");
    setIntensity(3);
    setSubmitting(false);
    onClose();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={[styles.container, { backgroundColor: colors.background, paddingBottom: insets.bottom + 16 }]}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: colors.foreground }]}>LOG ENTRY</Text>
          <TouchableOpacity onPress={onClose}>
            <Feather name="x" size={20} color={colors.mutedForeground} />
          </TouchableOpacity>
        </View>

        <ScrollView showsVerticalScrollIndicator={false}>
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

                return (
                  <TouchableOpacity
                    key={cfg.domain}
                    style={[
                      styles.domainBtn,
                      {
                        borderColor: isSelected ? cfg.color : colors.border,
                        backgroundColor: isSelected ? cfg.color + "20" : colors.card,
                      },
                    ]}
                    onPress={() => handleDomainSelect(cfg.domain, cfg.types[0]!.key)}
                    activeOpacity={0.7}
                  >
                    <View style={styles.domainBtnMain}>
                      <Feather
                        name={cfg.icon as "activity"}
                        size={16}
                        color={isSelected ? cfg.color : colors.mutedForeground}
                      />
                      <Text style={[styles.domainLabel, { color: isSelected ? cfg.color : colors.mutedForeground }]}>
                        {cfg.domain}
                      </Text>
                    </View>
                    {/* Streak badge on button */}
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
                borderColor: tier === "none" ? colors.border : tierColor + "50",
                backgroundColor: tier === "none" ? "transparent" : tierColor + "0E",
                opacity: bannerOpacity,
                transform: [{ translateY: bannerTranslate }],
                marginBottom: 24,
              },
            ]}
          >
            <View style={styles.multiplierLeft}>
              {tier !== "none" && (
                <Animated.View style={{ opacity: (tier === "high" || tier === "max") ? pulseOpacity : 1 }}>
                  <Feather
                    name="zap"
                    size={13}
                    color={tierColor}
                  />
                </Animated.View>
              )}
              <View>
                <Text style={[
                  styles.multiplierMain,
                  { color: tier === "none" ? colors.mutedForeground : tierColor },
                ]}>
                  {tier === "none"
                    ? "NO STREAK  ·  BASE"
                    : `×${multiplier.toFixed(1)}  ·  ${streak}D  ·  ${TIER_LABELS[tier]}`
                  }
                </Text>
                {tier !== "none" && bonusGain > 0 && (
                  <Text style={[styles.multiplierSub, { color: colors.mutedForeground }]}>
                    base {baseDelta.toFixed(1)} pts  →  boosted
                  </Text>
                )}
              </View>
            </View>

            <View style={styles.multiplierRight}>
              <Text style={[
                styles.multiplierPts,
                { color: tier === "none" ? colors.mutedForeground : tierColor },
              ]}>
                +{bonusDelta.toFixed(1)}
              </Text>
              <Text style={[styles.multiplierPtsLabel, { color: colors.mutedForeground }]}>
                pts
              </Text>
            </View>
          </Animated.View>

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
                      borderColor: selectedType === type.key ? config.color : colors.border,
                      backgroundColor: selectedType === type.key ? config.color + "20" : "transparent",
                    },
                  ]}
                  onPress={() => setSelectedType(type.key)}
                  activeOpacity={0.7}
                >
                  <Text style={[
                    styles.typeLabel,
                    { color: selectedType === type.key ? config.color : colors.mutedForeground },
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
                    { backgroundColor: intensity >= i ? config.color : colors.muted },
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
            <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>NOTE (OPTIONAL)</Text>
            <TextInput
              style={[
                styles.input,
                {
                  color: colors.foreground,
                  borderColor: colors.border,
                  backgroundColor: colors.card,
                },
              ]}
              placeholder="What happened. Be specific."
              placeholderTextColor={colors.mutedForeground}
              value={note}
              onChangeText={setNote}
              multiline
              numberOfLines={3}
            />
          </View>
        </ScrollView>

        {/* Submit — shows bonus pts */}
        <TouchableOpacity
          style={[styles.submitBtn, { backgroundColor: config.color }]}
          onPress={handleSubmit}
          activeOpacity={0.8}
          disabled={submitting}
        >
          <Text style={styles.submitText}>LOG IT</Text>
          <View style={styles.submitDivider} />
          <Text style={styles.submitPts}>
            +{bonusDelta.toFixed(1)} pts{tier !== "none" && tier !== "low" ? `  ×${multiplier.toFixed(1)}` : ""}
          </Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 24,
    marginTop: 8,
  },
  title: {
    fontSize: 14,
    fontWeight: "700" as const,
    letterSpacing: 3,
  },
  section: {
    marginBottom: 24,
    gap: 10,
  },
  sectionLabel: {
    fontSize: 9,
    fontWeight: "600" as const,
    letterSpacing: 2,
  },
  domainGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  domainBtn: {
    flex: 1,
    minWidth: "45%",
    padding: 12,
    borderWidth: 1,
    borderRadius: 4,
    gap: 8,
  },
  domainBtnMain: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  domainLabel: {
    fontSize: 10,
    fontWeight: "700" as const,
    letterSpacing: 2,
  },
  domainStreakBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    alignSelf: "flex-start",
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 2,
  },
  domainStreakText: {
    fontSize: 8,
    fontWeight: "700" as const,
    letterSpacing: 1,
  },
  multiplierBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  multiplierLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flex: 1,
  },
  multiplierMain: {
    fontSize: 11,
    fontWeight: "700" as const,
    letterSpacing: 1.5,
  },
  multiplierSub: {
    fontSize: 9,
    letterSpacing: 0.5,
    marginTop: 2,
  },
  multiplierRight: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 3,
  },
  multiplierPts: {
    fontSize: 22,
    fontWeight: "800" as const,
    letterSpacing: -0.5,
  },
  multiplierPtsLabel: {
    fontSize: 10,
    fontWeight: "600" as const,
    letterSpacing: 1,
  },
  typeRow: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
  },
  typeBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderRadius: 2,
  },
  typeLabel: {
    fontSize: 11,
    fontWeight: "600" as const,
  },
  intensityRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  intensityBtn: {
    width: 32,
    height: 6,
    borderRadius: 1,
  },
  intensityLabel: {
    fontSize: 11,
    marginLeft: 4,
  },
  input: {
    borderWidth: 1,
    borderRadius: 4,
    padding: 12,
    fontSize: 13,
    minHeight: 80,
    textAlignVertical: "top",
  },
  submitBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
    borderRadius: 2,
    marginTop: 8,
    gap: 12,
  },
  submitText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "700" as const,
    letterSpacing: 3,
  },
  submitDivider: {
    width: StyleSheet.hairlineWidth,
    height: 16,
    backgroundColor: "#FFFFFF40",
  },
  submitPts: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "600" as const,
    letterSpacing: 1,
    opacity: 0.85,
  },
});
