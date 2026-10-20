import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import { BackHandler, Pressable, StyleSheet, Text, View } from "react-native";

import { AuthField } from "@/components/AuthField";
import { OnboardingFrame, OptionList, OptionRow } from "@/components/onboarding/OnboardingFrame";
import { space, type } from "@/constants/type";
import { useColors } from "@/hooks/useColors";
import {
  MAX_GOAL_LENGTH,
  MAX_STOPPED_BEFORE_LENGTH,
  RANKED_DOMAINS,
  type RankedDomain as Domain,
} from "@/lib/onboarding/payload";
import {
  completeRatings,
  nextUnrated,
  objectiveHint,
  ratingsHint,
  weaknessHint,
  type OnboardingStep,
  type PartialRatings,
} from "@/lib/onboarding/steps";

const DOMAIN_DESC: Record<Domain, string> = {
  BODY: "Fitness, sleep, nutrition, energy",
  MIND: "Focus, deep work, learning",
  WEALTH: "Income, savings, money habits",
  SOCIAL: "Relationships, how you show up",
  DISCIPLINE: "Consistency, follow-through",
};

const PRESET_GOALS: { label: string; domain: Domain }[] = [
  { label: "Build a body worth respecting", domain: "BODY" },
  { label: "Escape the 9-to-5", domain: "WEALTH" },
  { label: "Become mentally elite", domain: "MIND" },
  { label: "Build $10k emergency fund", domain: "WEALTH" },
  { label: "Run 5km without stopping", domain: "BODY" },
  { label: "Read 24 books this year", domain: "MIND" },
  { label: "Build an unbreakable daily routine", domain: "DISCIPLINE" },
  { label: "Launch a side income stream", domain: "WEALTH" },
  { label: "Master a new skill completely", domain: "MIND" },
  { label: "I don't know yet — help me find one", domain: "DISCIPLINE" },
];

/** The assessment runs as three steps on one route, so the answers survive moving back and forth. */
const SUBSTEPS: OnboardingStep[] = ["rate", "objective", "weakness"];

export default function AssessmentScreen() {
  const colors = useColors();
  const [sub, setSub] = useState(0);

  // Every domain starts unset: nobody ships a default 5.
  const [ratings, setRatings] = useState<PartialRatings>({});
  const [active, setActive] = useState<Domain | null>(RANKED_DOMAINS[0] ?? null);
  const [selectedGoal, setSelectedGoal] = useState<string | null>(null);
  const [customGoal, setCustomGoal] = useState("");
  const [showCustom, setShowCustom] = useState(false);
  const [weakness, setWeakness] = useState<Domain | null>(null);
  const [stoppedBefore, setStoppedBefore] = useState("");
  const [homeFirst, setHomeFirst] = useState(false);

  const primaryGoal = showCustom ? customGoal.trim() : (selectedGoal ?? "");

  const back = () => (sub > 0 ? setSub(sub - 1) : router.back());

  // Android back walks the sub-steps before leaving the screen.
  useEffect(() => {
    if (sub === 0) return;
    const h = BackHandler.addEventListener("hardwareBackPress", () => {
      setSub((n) => Math.max(0, n - 1));
      return true;
    });
    return () => h.remove();
  }, [sub]);

  const rate = (domain: Domain, value: number) => {
    const next = { ...ratings, [domain]: value };
    setRatings(next);
    setActive(nextUnrated(next, domain));
  };

  const handleSelectGoal = (goal: string) => {
    setSelectedGoal(goal);
    setShowCustom(false);
    if (!weakness) {
      const match = PRESET_GOALS.find((g) => g.label === goal);
      if (match) setWeakness(match.domain);
    }
  };

  const finish = () => {
    const full = completeRatings(ratings);
    if (!full || objectiveHint(primaryGoal) || !weakness) return;
    router.push({
      pathname: "/onboarding/identity",
      params: {
        ratings: JSON.stringify(full),
        primaryGoal,
        weakness,
        stoppedBefore: stoppedBefore.trim(),
        ...(homeFirst ? { homePath: "1" } : {}),
      },
    });
  };

  if (sub === 0) {
    const hint = ratingsHint(ratings);
    return (
      <OnboardingFrame
        key="rate"
        step={SUBSTEPS[0]!}
        onBack={back}
        title="Where are you, actually?"
        subtitle="Rate each domain from 1 to 10. Today, not on a good day."
        hint={hint}
        action={{ label: "Continue", onPress: () => setSub(1), disabled: hint !== null }}
      >
        <OptionList>
          {RANKED_DOMAINS.map((d) => {
            const value = ratings[d];
            const open = active === d;
            return (
              <View key={d} style={{ borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth }}>
                <Pressable
                  onPress={() => setActive(open ? null : d)}
                  android_ripple={{ color: "rgba(168,121,255,0.12)" }}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: open }}
                  accessibilityLabel={`${d}, ${value ? `rated ${value} of 10` : "not rated"}`}
                  style={s.domainRow}
                >
                  <View style={[s.dot, { backgroundColor: colors.domain[d] }]} />
                  <View style={s.rowText}>
                    <Text style={[type.bodyStrong, { color: colors.foreground }]}>{d}</Text>
                    <Text style={[type.meta, { color: colors.mutedForeground }]}>{DOMAIN_DESC[d]}</Text>
                  </View>
                  <Text style={[type.number, { color: value ? colors.foreground : colors.subtle }]}>{value ?? "–"}</Text>
                </Pressable>
                {open ? <RatingGrid domain={d} value={value} onChange={(v) => rate(d, v)} /> : null}
              </View>
            );
          })}
        </OptionList>
      </OnboardingFrame>
    );
  }

  if (sub === 1) {
    const hint = objectiveHint(primaryGoal);
    return (
      <OnboardingFrame
        key="objective"
        step={SUBSTEPS[1]!}
        onBack={back}
        title="What are you here to change?"
        subtitle="Pick one, or write your own."
        hint={hint}
        action={{ label: "Continue", onPress: () => setSub(2), disabled: hint !== null }}
      >
        <OptionList>
          {PRESET_GOALS.map((g) => (
            <OptionRow
              key={g.label}
              title={g.label}
              dot={colors.domain[g.domain]}
              selected={!showCustom && selectedGoal === g.label}
              onPress={() => handleSelectGoal(g.label)}
            />
          ))}
          <OptionRow
            title="Write my own"
            selected={showCustom}
            onPress={() => {
              setShowCustom(true);
              setSelectedGoal(null);
            }}
          />
        </OptionList>
        {showCustom ? (
          <AuthField
            label="YOUR OBJECTIVE"
            value={customGoal}
            onChangeText={setCustomGoal}
            placeholder="What do you actually want to achieve?"
            autoCapitalize="sentences"
            multiline
            maxLength={MAX_GOAL_LENGTH}
            hint={`${customGoal.length}/${MAX_GOAL_LENGTH}`}
            autoFocus
          />
        ) : null}
      </OnboardingFrame>
    );
  }

  const hint = weaknessHint(weakness);
  return (
    <OnboardingFrame
      key="weakness"
      step={SUBSTEPS[2]!}
      onBack={back}
      title="What has held you back most?"
      subtitle="Pick the one domain that has cost you the most."
      hint={hint}
      action={{ label: "Continue", onPress: finish, disabled: hint !== null }}
    >
      <OptionList>
        {RANKED_DOMAINS.map((d) => (
          <OptionRow
            key={d}
            title={d}
            subtitle={DOMAIN_DESC[d]}
            dot={colors.domain[d]}
            selected={weakness === d}
            onPress={() => setWeakness(d)}
          />
        ))}
      </OptionList>
      <AuthField
        label="WHAT HAS STOPPED YOU BEFORE? (OPTIONAL)"
        value={stoppedBefore}
        onChangeText={setStoppedBefore}
        placeholder="What broke the last time you tried"
        autoCapitalize="sentences"
        multiline
        maxLength={MAX_STOPPED_BEFORE_LENGTH}
        hint={`Say it plainly. THE SYSTEM reads it. ${stoppedBefore.length}/${MAX_STOPPED_BEFORE_LENGTH}`}
      />
      {/* Soft opt-in: BODY quests start as home sessions; the gym is never blocked. */}
      <OptionList>
        <OptionRow
          kind="checkbox"
          title="Haven't trained in a while? Start at home"
          subtitle="BODY quests are home sessions until you finish six. The gym stays open."
          selected={homeFirst}
          onPress={() => setHomeFirst((v) => !v)}
        />
      </OptionList>
    </OnboardingFrame>
  );
}

/** 1–10 as two rows of five 48dp buttons, with the scale's ends named. */
function RatingGrid({ domain, value, onChange }: { domain: Domain; value?: number; onChange: (v: number) => void }) {
  const colors = useColors();
  const rows = [
    [1, 2, 3, 4, 5],
    [6, 7, 8, 9, 10],
  ];
  return (
    <View style={s.grid}>
      {rows.map((row) => (
        <View key={row[0]} style={s.gridRow}>
          {row.map((n) => {
            const on = value === n;
            return (
              <View key={n} style={[s.cellClip, { borderColor: on ? colors.primary : colors.border }]}>
                <Pressable
                  onPress={() => onChange(n)}
                  android_ripple={{ color: "rgba(168,121,255,0.2)" }}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={`${domain} ${n} of 10`}
                  style={[s.cell, on && { backgroundColor: colors.accentFill }]}
                >
                  <Text style={[type.number, { color: on ? colors.primaryForeground : colors.foreground }]}>{n}</Text>
                </Pressable>
              </View>
            );
          })}
        </View>
      ))}
      <View style={s.scale}>
        <Text style={[type.meta, { color: colors.mutedForeground }]}>1 · Struggling</Text>
        <Text style={[type.meta, { color: colors.mutedForeground }]}>10 · Elite</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  domainRow: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm + 4,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  rowText: { flex: 1, gap: 2 },
  grid: { paddingHorizontal: space.md, paddingBottom: space.md, gap: space.sm },
  gridRow: { flexDirection: "row", gap: space.sm },
  cellClip: { flex: 1, borderWidth: 1, borderRadius: 4, overflow: "hidden" },
  cell: { minHeight: 48, alignItems: "center", justifyContent: "center" },
  scale: { flexDirection: "row", justifyContent: "space-between" },
});
