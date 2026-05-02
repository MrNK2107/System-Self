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
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import type { Domain } from "@/context/AppContext";

const DOMAINS: Domain[] = ["BODY", "MIND", "WEALTH", "DISCIPLINE"];

const DOMAIN_DESCRIPTIONS: Record<Domain, string> = {
  BODY: "Physical fitness, sleep, nutrition",
  MIND: "Focus, learning, mental clarity",
  WEALTH: "Income, savings, financial discipline",
  DISCIPLINE: "Consistency, habits, follow-through",
};

interface AssessmentData {
  domainRatings: Record<Domain, number>;
  primaryGoal: string;
  biggestWeakness: Domain;
  whatStoppedYou: string;
}

export { AssessmentData };

function RatingSelector({
  value,
  onChange,
  color,
}: {
  value: number;
  onChange: (v: number) => void;
  color: string;
}) {
  return (
    <View style={styles.ratingRow}>
      {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(i => (
        <TouchableOpacity
          key={i}
          style={[
            styles.ratingBtn,
            { backgroundColor: value >= i ? color : "transparent", borderColor: value >= i ? color : "#2A2D38" }
          ]}
          onPress={() => onChange(i)}
          activeOpacity={0.7}
        />
      ))}
      <Text style={{ color: "#6B7280", fontSize: 11, marginLeft: 4, fontFamily: "SpaceMono" }}>{value}/10</Text>
    </View>
  );
}

export default function AssessmentScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const DOMAIN_COLORS: Record<Domain, string> = {
    BODY: "#E05555",
    MIND: "#3A7BD5",
    WEALTH: "#4B8B6F",
    DISCIPLINE: "#C4873A",
  };

  const [ratings, setRatings] = useState<Record<Domain, number>>({
    BODY: 5, MIND: 5, WEALTH: 5, DISCIPLINE: 5,
  });
  const [primaryGoal, setPrimaryGoal] = useState("");
  const [weakness, setWeakness] = useState<Domain>("DISCIPLINE");
  const [stoppedYou, setStoppedYou] = useState("");

  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);

  const canContinue = primaryGoal.trim().length > 10;

  const handleNext = () => {
    router.push({
      pathname: "/onboarding/identity",
      params: {
        ratings: JSON.stringify(ratings),
        primaryGoal: primaryGoal.trim(),
        weakness,
        stoppedYou: stoppedYou.trim(),
      },
    });
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: topPad + 16, paddingBottom: insets.bottom + 80 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.headerSection}>
          <Text style={[styles.step, { color: colors.mutedForeground }]}>BASELINE ASSESSMENT</Text>
          <Text style={[styles.title, { color: colors.foreground }]}>Where are you, actually?</Text>
        </View>

        {DOMAINS.map(domain => (
          <View key={domain} style={[styles.section, { borderColor: colors.border, backgroundColor: colors.card }]}>
            <View style={styles.domainHeader}>
              <View style={[styles.domainDot, { backgroundColor: DOMAIN_COLORS[domain] }]} />
              <View>
                <Text style={[styles.domainName, { color: colors.foreground }]}>{domain}</Text>
                <Text style={[styles.domainDesc, { color: colors.mutedForeground }]}>{DOMAIN_DESCRIPTIONS[domain]}</Text>
              </View>
            </View>
            <RatingSelector
              value={ratings[domain]}
              onChange={v => setRatings(r => ({ ...r, [domain]: v }))}
              color={DOMAIN_COLORS[domain]}
            />
          </View>
        ))}

        <View style={[styles.section, { borderColor: colors.border, backgroundColor: colors.card }]}>
          <Text style={[styles.questionLabel, { color: colors.mutedForeground }]}>YOUR PRIMARY GOAL</Text>
          <TextInput
            style={[styles.textInput, { color: colors.foreground, borderColor: colors.border }]}
            placeholder="What do you actually want to achieve?"
            placeholderTextColor={colors.mutedForeground}
            value={primaryGoal}
            onChangeText={setPrimaryGoal}
            multiline
            numberOfLines={2}
          />
        </View>

        <View style={[styles.section, { borderColor: colors.border, backgroundColor: colors.card }]}>
          <Text style={[styles.questionLabel, { color: colors.mutedForeground }]}>BIGGEST WEAKNESS</Text>
          <View style={styles.weaknessGrid}>
            {DOMAINS.map(d => (
              <TouchableOpacity
                key={d}
                style={[
                  styles.weaknessBtn,
                  {
                    borderColor: weakness === d ? DOMAIN_COLORS[d] : colors.border,
                    backgroundColor: weakness === d ? DOMAIN_COLORS[d] + "20" : "transparent",
                  }
                ]}
                onPress={() => setWeakness(d)}
                activeOpacity={0.7}
              >
                <Text style={[styles.weaknessBtnText, { color: weakness === d ? DOMAIN_COLORS[d] : colors.mutedForeground }]}>
                  {d}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={[styles.section, { borderColor: colors.border, backgroundColor: colors.card }]}>
          <Text style={[styles.questionLabel, { color: colors.mutedForeground }]}>WHAT HAS STOPPED YOU BEFORE (OPTIONAL)</Text>
          <TextInput
            style={[styles.textInput, { color: colors.foreground, borderColor: colors.border }]}
            placeholder="Be honest. No one else is reading this."
            placeholderTextColor={colors.mutedForeground}
            value={stoppedYou}
            onChangeText={setStoppedYou}
            multiline
            numberOfLines={2}
          />
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 16, backgroundColor: colors.background, borderTopColor: colors.border }]}>
        <TouchableOpacity
          style={[styles.nextBtn, { backgroundColor: canContinue ? colors.primary : colors.muted }]}
          onPress={handleNext}
          disabled={!canContinue}
          activeOpacity={0.8}
        >
          <Text style={[styles.nextBtnText, { color: canContinue ? "#fff" : colors.mutedForeground }]}>CONTINUE</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { paddingHorizontal: 20, gap: 12 },
  headerSection: { gap: 4, marginBottom: 4 },
  step: { fontSize: 9, letterSpacing: 3, fontWeight: "600" as const },
  title: { fontSize: 22, fontWeight: "700" as const, lineHeight: 30 },
  section: {
    padding: 16,
    borderRadius: 4,
    borderWidth: 1,
    gap: 12,
  },
  domainHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  domainDot: { width: 8, height: 8, borderRadius: 1 },
  domainName: { fontSize: 12, fontWeight: "700" as const, letterSpacing: 2 },
  domainDesc: { fontSize: 11, marginTop: 1 },
  ratingRow: { flexDirection: "row", alignItems: "center", gap: 4, flexWrap: "wrap" },
  ratingBtn: { width: 18, height: 18, borderRadius: 2, borderWidth: 1 },
  questionLabel: { fontSize: 9, letterSpacing: 2, fontWeight: "600" as const },
  textInput: {
    fontSize: 13,
    borderWidth: 1,
    borderRadius: 4,
    padding: 10,
    minHeight: 60,
    textAlignVertical: "top",
  },
  weaknessGrid: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  weaknessBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderRadius: 2,
  },
  weaknessBtnText: { fontSize: 10, fontWeight: "700" as const, letterSpacing: 2 },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  nextBtn: { padding: 16, alignItems: "center", borderRadius: 2 },
  nextBtnText: { fontSize: 11, fontWeight: "700" as const, letterSpacing: 3 },
});
