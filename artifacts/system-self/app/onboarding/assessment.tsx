import React, { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import {
  DEFAULT_RATING,
  MAX_GOAL_LENGTH,
  MAX_STOPPED_BEFORE_LENGTH,
  MIN_GOAL_LENGTH,
  RANKED_DOMAINS,
  type RankedDomain as Domain,
} from "@/lib/onboarding/payload";

const DOMAINS: readonly Domain[] = RANKED_DOMAINS;

const DOMAIN_CONFIG: Record<Domain, { desc: string; color: string; icon: string }> = {
  BODY: { desc: "Physical fitness, sleep, nutrition, energy", color: "#E05555", icon: "activity" },
  MIND: { desc: "Focus, deep work, learning, mental clarity", color: "#3A7BD5", icon: "zap" },
  WEALTH: { desc: "Income, savings, investing, financial discipline", color: "#4B8B6F", icon: "trending-up" },
  SOCIAL: { desc: "Relationships, presence, community, how you show up", color: "#B05CD6", icon: "users" },
  DISCIPLINE: { desc: "Consistency, habit execution, follow-through", color: "#C4873A", icon: "target" },
};

const PRESET_GOALS = [
  { label: "Build a body worth respecting", domain: "BODY" as Domain },
  { label: "Escape the 9-to-5", domain: "WEALTH" as Domain },
  { label: "Become mentally elite", domain: "MIND" as Domain },
  { label: "Build $10k emergency fund", domain: "WEALTH" as Domain },
  { label: "Run 5km without stopping", domain: "BODY" as Domain },
  { label: "Read 24 books this year", domain: "MIND" as Domain },
  { label: "Build an unbreakable daily routine", domain: "DISCIPLINE" as Domain },
  { label: "Launch a side income stream", domain: "WEALTH" as Domain },
  { label: "Master a new skill completely", domain: "MIND" as Domain },
  { label: "I don't know yet — help me find one", domain: "DISCIPLINE" as Domain },
];

const DOMAIN_LABELS: Record<Domain, string> = {
  BODY: "Physical",
  MIND: "Mental",
  WEALTH: "Financial",
  SOCIAL: "Social",
  DISCIPLINE: "Discipline",
};

function StepBadge({ step, total }: { step: number; total: number }) {
  return (
    <View style={s.stepBadge}>
      {Array.from({ length: total }).map((_, i) => (
        <View
          key={i}
          style={[
            s.stepDot,
            { backgroundColor: i < step ? "#3A7BD5" : i === step ? "#3A7BD580" : "#1A1D24" },
          ]}
        />
      ))}
    </View>
  );
}

function DomainRatingCard({
  domain,
  value,
  onChange,
}: {
  domain: Domain;
  value: number;
  onChange: (v: number) => void;
}) {
  const { color, desc, icon } = DOMAIN_CONFIG[domain];
  const percentage = ((value - 1) / 9) * 100;

  return (
    <View style={[s.domainCard, { borderColor: `${color}30` }]}>
      <LinearGradient
        colors={[`${color}12`, "transparent"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={StyleSheet.absoluteFill}
      />
      <View style={s.domainCardTop}>
        <View style={[s.domainIconWrap, { backgroundColor: `${color}20`, borderColor: `${color}40` }]}>
          <Feather name={icon as "activity"} size={16} color={color} />
        </View>
        <View style={s.domainCardInfo}>
          <Text style={[s.domainName, { color }]}>{domain}</Text>
          <Text style={s.domainDesc}>{desc}</Text>
        </View>
        <View style={[s.ratingPill, { borderColor: `${color}50`, backgroundColor: `${color}15` }]}>
          <Text style={[s.ratingValue, { color }]}>{value}</Text>
          <Text style={s.ratingMax}>/10</Text>
        </View>
      </View>

      {/* Progress bar tap zones */}
      <View style={s.tapRow}>
        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(i => (
          <TouchableOpacity
            key={i}
            style={[
              s.tapSegment,
              {
                backgroundColor: value >= i ? color : `${color}20`,
                opacity: value >= i ? (i <= 3 ? 0.4 + i * 0.12 : 1) : 0.25,
              },
            ]}
            onPress={() => onChange(i)}
            activeOpacity={0.8}
          />
        ))}
      </View>

      <View style={s.ratingScale}>
        <Text style={s.scaleLabel}>Struggling</Text>
        <Text style={s.scaleLabel}>Average</Text>
        <Text style={s.scaleLabel}>Elite</Text>
      </View>
    </View>
  );
}

export default function AssessmentScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const [ratings, setRatings] = useState<Record<Domain, number>>({
    BODY: DEFAULT_RATING, MIND: DEFAULT_RATING, WEALTH: DEFAULT_RATING, SOCIAL: DEFAULT_RATING, DISCIPLINE: DEFAULT_RATING,
  });
  const [selectedGoal, setSelectedGoal] = useState<string | null>(null);
  const [customGoal, setCustomGoal] = useState("");
  const [showCustom, setShowCustom] = useState(false);
  const [weakness, setWeakness] = useState<Domain | null>(null);
  const [stoppedBefore, setStoppedBefore] = useState("");
  const [homeFirst, setHomeFirst] = useState(false);

  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);

  const primaryGoal = showCustom ? customGoal.trim() : (selectedGoal ?? "");
  const canContinue = primaryGoal.length >= MIN_GOAL_LENGTH && weakness !== null;

  const handleSelectGoal = (goal: string) => {
    setSelectedGoal(goal);
    setShowCustom(false);
    if (!weakness) {
      const match = PRESET_GOALS.find(g => g.label === goal);
      if (match) setWeakness(match.domain);
    }
  };

  const handleNext = () => {
    if (!canContinue) return;
    router.push({
      pathname: "/onboarding/identity",
      params: {
        ratings: JSON.stringify(ratings),
        primaryGoal,
        weakness: weakness ?? "DISCIPLINE",
        stoppedBefore: stoppedBefore.trim(),
        ...(homeFirst ? { homePath: "1" } : {}),
      },
    });
  };

  return (
    <KeyboardAvoidingView
      style={[s.container, { backgroundColor: colors.background }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      {/* Header */}
      <View style={[s.header, { paddingTop: topPad + 12, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Feather name="chevron-left" size={20} color={colors.mutedForeground} />
        </TouchableOpacity>
        <View style={s.headerCenter}>
          <Text style={s.headerLabel}>BASELINE ASSESSMENT</Text>
          <StepBadge step={0} total={4} />
        </View>
        <View style={{ width: 32 }} />
      </View>

      <ScrollView
        contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 100 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Title */}
        <View style={s.titleSection}>
          <Text style={[s.title, { color: colors.foreground }]}>
            Where are you,{"\n"}
            <Text style={{ color: "#3A7BD5" }}>actually?</Text>
          </Text>
          <Text style={[s.subtitle, { color: colors.mutedForeground }]}>
            Rate each domain honestly. THE SYSTEM uses this to calibrate your starting point.
          </Text>
        </View>

        {/* Domain ratings */}
        <View style={s.section}>
          {DOMAINS.map(domain => (
            <DomainRatingCard
              key={domain}
              domain={domain}
              value={ratings[domain]}
              onChange={v => setRatings(r => ({ ...r, [domain]: v }))}
            />
          ))}
        </View>

        {/* Goal selection */}
        <View style={[s.goalSection, { borderColor: colors.border, backgroundColor: colors.card }]}>
          <View style={s.goalHeader}>
            <Feather name="flag" size={14} color="#3A7BD5" />
            <Text style={s.goalHeaderText}>YOUR PRIMARY OBJECTIVE</Text>
          </View>
          <Text style={[s.goalSub, { color: colors.mutedForeground }]}>
            Select one, or write your own.
          </Text>

          <View style={s.goalGrid}>
            {PRESET_GOALS.map(goal => {
              const color = DOMAIN_CONFIG[goal.domain].color;
              const active = selectedGoal === goal.label && !showCustom;
              return (
                <TouchableOpacity
                  key={goal.label}
                  style={[
                    s.goalChip,
                    {
                      borderColor: active ? color : colors.border,
                      backgroundColor: active ? `${color}18` : colors.background,
                    },
                  ]}
                  onPress={() => handleSelectGoal(goal.label)}
                  activeOpacity={0.75}
                >
                  <View style={[s.goalDomain, { backgroundColor: `${color}30` }]}>
                    <Text style={[s.goalDomainText, { color }]}>
                      {DOMAIN_LABELS[goal.domain]}
                    </Text>
                  </View>
                  <Text style={[s.goalLabel, { color: active ? colors.foreground : colors.mutedForeground }]}>
                    {goal.label}
                  </Text>
                  {active && (
                    <Feather name="check" size={13} color={color} style={{ marginLeft: "auto" }} />
                  )}
                </TouchableOpacity>
              );
            })}

            {/* Write your own */}
            <TouchableOpacity
              style={[
                s.goalChip,
                s.customChip,
                {
                  borderColor: showCustom ? "#3A7BD5" : colors.border,
                  backgroundColor: showCustom ? "#3A7BD518" : colors.background,
                },
              ]}
              onPress={() => {
                setShowCustom(true);
                setSelectedGoal(null);
              }}
              activeOpacity={0.75}
            >
              <Feather name="edit-3" size={13} color={showCustom ? "#3A7BD5" : colors.mutedForeground} />
              <Text style={[s.goalLabel, { color: showCustom ? colors.foreground : colors.mutedForeground }]}>
                Write my own goal
              </Text>
            </TouchableOpacity>
          </View>

          {showCustom && (
            <TextInput
              style={[s.customInput, { color: colors.foreground, borderColor: "#3A7BD560", backgroundColor: "#3A7BD510" }]}
              placeholder="Describe what you actually want to achieve..."
              placeholderTextColor={colors.mutedForeground}
              value={customGoal}
              onChangeText={setCustomGoal}
              multiline
              numberOfLines={3}
              maxLength={MAX_GOAL_LENGTH}
              autoFocus
            />
          )}
        </View>

        {/* Biggest weakness */}
        <View style={[s.weaknessSection, { borderColor: colors.border, backgroundColor: colors.card }]}>
          <View style={s.goalHeader}>
            <Feather name="alert-triangle" size={14} color="#C4873A" />
            <Text style={s.goalHeaderText}>BIGGEST WEAKNESS</Text>
          </View>
          <Text style={[s.goalSub, { color: colors.mutedForeground }]}>
            Which domain has held you back the most?
          </Text>
          <View style={s.weaknessGrid}>
            {DOMAINS.map(d => {
              const { color, icon } = DOMAIN_CONFIG[d];
              const active = weakness === d;
              return (
                <TouchableOpacity
                  key={d}
                  style={[
                    s.weaknessCard,
                    {
                      borderColor: active ? color : colors.border,
                      backgroundColor: active ? `${color}18` : "transparent",
                    },
                  ]}
                  onPress={() => setWeakness(d)}
                  activeOpacity={0.75}
                >
                  <View style={[s.weaknessIcon, { backgroundColor: `${color}20` }]}>
                    <Feather name={icon as "activity"} size={16} color={color} />
                  </View>
                  <Text style={[s.weaknessName, { color: active ? color : colors.foreground }]}>
                    {d}
                  </Text>
                  {active && <View style={[s.weaknessMark, { backgroundColor: color }]} />}
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* What has stopped you before (optional) */}
        <View style={[s.weaknessSection, { borderColor: colors.border, backgroundColor: colors.card }]}>
          <View style={s.goalHeader}>
            <Feather name="slash" size={14} color={colors.mutedForeground} />
            <Text style={[s.goalHeaderText, { color: colors.mutedForeground }]}>WHAT HAS STOPPED YOU BEFORE?</Text>
          </View>
          <Text style={[s.goalSub, { color: colors.mutedForeground }]}>
            Optional. Say it plainly. THE SYSTEM reads it.
          </Text>
          <TextInput
            style={[s.customInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
            placeholder="What broke the last time you tried..."
            placeholderTextColor={colors.mutedForeground}
            value={stoppedBefore}
            onChangeText={setStoppedBefore}
            multiline
            numberOfLines={3}
            maxLength={MAX_STOPPED_BEFORE_LENGTH}
            accessibilityLabel="What has stopped you before"
          />
          <Text style={[s.charCount, { color: colors.subtle }]}>
            {stoppedBefore.length}/{MAX_STOPPED_BEFORE_LENGTH}
          </Text>
        </View>

        {/* Soft opt-in: BODY quests start as home sessions; the gym is never blocked. */}
        <TouchableOpacity
          style={[s.weaknessSection, { borderColor: homeFirst ? "#E05555" : colors.border, backgroundColor: homeFirst ? "#E0555510" : colors.card }]}
          onPress={() => setHomeFirst((v) => !v)}
          activeOpacity={0.8}
          accessibilityRole="switch"
          accessibilityState={{ checked: homeFirst }}
          accessibilityLabel="Haven't trained in a while? Start at home first"
        >
          <View style={s.goalHeader}>
            <Feather name={homeFirst ? "check-square" : "square"} size={14} color={homeFirst ? "#E05555" : colors.mutedForeground} />
            <Text style={[s.goalHeaderText, { color: homeFirst ? "#E05555" : colors.mutedForeground }]}>
              Haven&apos;t trained in a while? START AT HOME FIRST
            </Text>
          </View>
          <Text style={[s.goalSub, { color: colors.mutedForeground }]}>
            Your BODY quests are home sessions until you finish six. The gym stays open to you anyway.
          </Text>
        </TouchableOpacity>
      </ScrollView>

      {/* Footer CTA */}
      <View style={[s.footer, { paddingBottom: insets.bottom + 16, borderTopColor: colors.border, backgroundColor: colors.background }]}>
        {!canContinue && (
          <Text style={[s.missingHint, { color: colors.subtle }]}>
            {!primaryGoal ? "Select or write your objective above" : "Select your biggest weakness"}
          </Text>
        )}
        <TouchableOpacity
          onPress={handleNext}
          disabled={!canContinue}
          activeOpacity={0.85}
          style={{ borderRadius: 2, overflow: "hidden" }}
        >
          <LinearGradient
            colors={canContinue ? ["#3A7BD5", "#2A5BA5"] : ["#252830", "#252830"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={s.nextBtn}
          >
            <Text style={[s.nextBtnText, { color: canContinue ? "#FFFFFF" : colors.subtle }]}>
              CONTINUE
            </Text>
            {canContinue && <Feather name="arrow-right" size={16} color="#FFFFFF" />}
          </LinearGradient>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  headerCenter: {
    flex: 1,
    alignItems: "center",
    gap: 8,
  },
  headerLabel: {
    fontSize: 9,
    letterSpacing: 3,
    color: "#4A4D58",
    fontWeight: "600" as const,
  },
  stepBadge: {
    flexDirection: "row",
    gap: 4,
  },
  stepDot: {
    width: 16,
    height: 2,
    borderRadius: 1,
  },
  scroll: {
    paddingHorizontal: 16,
    paddingTop: 20,
    gap: 16,
  },
  titleSection: {
    gap: 8,
    paddingHorizontal: 4,
  },
  title: {
    fontSize: 28,
    fontWeight: "800" as const,
    lineHeight: 36,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 13,
    lineHeight: 20,
  },
  section: {
    gap: 10,
  },
  domainCard: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 14,
    gap: 12,
    overflow: "hidden",
  },
  domainCardTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  domainIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  domainCardInfo: {
    flex: 1,
    gap: 2,
  },
  domainName: {
    fontSize: 12,
    fontWeight: "800" as const,
    letterSpacing: 2,
  },
  domainDesc: {
    fontSize: 11,
    color: "#4A4D58",
    lineHeight: 15,
  },
  ratingPill: {
    flexDirection: "row",
    alignItems: "baseline",
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    gap: 1,
  },
  ratingValue: {
    fontSize: 18,
    fontWeight: "800" as const,
    lineHeight: 22,
  },
  ratingMax: {
    fontSize: 10,
    color: "#4A4D58",
    fontWeight: "600" as const,
  },
  tapRow: {
    flexDirection: "row",
    gap: 3,
    height: 20,
  },
  tapSegment: {
    flex: 1,
    borderRadius: 2,
  },
  ratingScale: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: -4,
  },
  scaleLabel: {
    fontSize: 9,
    color: "#2A2D38",
    letterSpacing: 0.5,
    fontWeight: "600" as const,
  },
  goalSection: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 16,
    gap: 12,
  },
  goalHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  goalHeaderText: {
    fontSize: 10,
    letterSpacing: 2.5,
    color: "#3A7BD5",
    fontWeight: "700" as const,
  },
  goalSub: {
    fontSize: 12,
    lineHeight: 18,
    marginTop: -6,
  },
  goalGrid: {
    gap: 7,
  },
  goalChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  customChip: {
    marginTop: 2,
  },
  goalDomain: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  goalDomainText: {
    fontSize: 8,
    fontWeight: "700" as const,
    letterSpacing: 1,
  },
  goalLabel: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "500" as const,
  },
  customInput: {
    borderWidth: 1,
    borderRadius: 6,
    padding: 12,
    fontSize: 13,
    minHeight: 80,
    textAlignVertical: "top",
    lineHeight: 20,
  },
  weaknessSection: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 16,
    gap: 12,
  },
  weaknessGrid: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
  },
  weaknessCard: {
    flex: 1,
    minWidth: "44%",
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    alignItems: "center",
    gap: 8,
    position: "relative",
  },
  weaknessIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  weaknessName: {
    fontSize: 10,
    fontWeight: "700" as const,
    letterSpacing: 2,
  },
  weaknessMark: {
    position: "absolute",
    top: 8,
    right: 8,
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  footer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  missingHint: {
    textAlign: "center",
    fontSize: 11,
  },
  charCount: {
    alignSelf: "flex-end",
    fontSize: 10,
    marginTop: -6,
    fontVariant: ["tabular-nums"],
  },
  nextBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 16,
    paddingHorizontal: 24,
  },
  nextBtnText: {
    fontSize: 12,
    fontWeight: "700" as const,
    letterSpacing: 3,
  },
});
