import React, { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { LifeContext } from "@workspace/contracts";
import { lifeContext as lifeContextDef } from "@workspace/engine";
import { lifeContextOptions } from "@/lib/game/life";
import { useColors } from "@/hooks/useColors";

function StepBadge({ step }: { step: number }) {
  return (
    <View style={s.stepRow}>
      {[0, 1, 2, 3].map(i => (
        <View
          key={i}
          style={[
            s.stepSeg,
            {
              backgroundColor:
                i < step ? "#3A7BD5" : i === step ? "#3A7BD550" : "#1A1D24",
            },
          ]}
        />
      ))}
    </View>
  );
}

export default function LifeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams();

  const [life, setLife] = useState<LifeContext>("student");

  const handleNext = () => {
    router.push({
      pathname: "/onboarding/calibrating",
      params: { ...params, lifeContext: life },
    });
  };

  return (
    <KeyboardAvoidingView
      style={[s.container, { backgroundColor: colors.background }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <View style={[s.header, { paddingTop: insets.top + 16, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={s.back} accessibilityRole="button" accessibilityLabel="Back">
          <Feather name="chevron-left" size={20} color={colors.mutedForeground} />
        </TouchableOpacity>
        <View style={s.headerMid}>
          <Text style={[s.headerTag, { color: colors.subtle }]}>LIFE CONTEXT</Text>
          <StepBadge step={2} />
        </View>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView
        contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 100 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={s.titleBlock}>
          <Text style={[s.title, { color: colors.foreground }]}>
            What does your{" "}
            <Text style={{ color: "#3A7BD5" }}>day look like?</Text>
          </Text>
          <Text style={[s.subtitle, { color: colors.mutedForeground }]}>
            This shapes the quests, never the score. Change it any time in settings.
          </Text>
        </View>

        <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {lifeContextOptions().map(opt => {
            const active = life === opt.key;
            return (
              <TouchableOpacity
                key={opt.key}
                style={[
                  s.optionRow,
                  {
                    borderColor: active ? "#3A7BD560" : colors.border,
                    backgroundColor: active ? "#3A7BD510" : "transparent",
                  },
                ]}
                onPress={() => setLife(opt.key)}
                activeOpacity={0.75}
                accessibilityRole="radio"
                accessibilityState={{ selected: active }}
                accessibilityLabel={opt.label}
              >
                <View style={s.optionText}>
                  <Text style={[s.optionLabel, { color: active ? "#3A7BD5" : colors.foreground }]}>
                    {opt.label.toUpperCase()}
                  </Text>
                  <Text style={[s.optionDesc, { color: colors.mutedForeground }]}>
                    {lifeContextDef(opt.key).promptLine}
                  </Text>
                </View>
                <View style={[s.radioOuter, { borderColor: active ? "#3A7BD5" : colors.border }]}>
                  {active && <View style={s.radioInner} />}
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>

      <View style={[s.footer, { paddingBottom: insets.bottom + 16, borderTopColor: colors.border, backgroundColor: colors.background }]}>
        <TouchableOpacity onPress={handleNext} activeOpacity={0.85} style={{ borderRadius: 2, overflow: "hidden" }}>
          <LinearGradient
            colors={["#3A7BD5", "#2860B4"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={s.nextBtn}
          >
            <Text style={[s.nextText, { color: "#fff" }]}>CONTINUE</Text>
            <Feather name="arrow-right" size={16} color="#fff" />
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
  back: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  headerMid: { flex: 1, alignItems: "center", gap: 8 },
  headerTag: { fontSize: 9, letterSpacing: 3, fontWeight: "700" as const },
  stepRow: { flexDirection: "row", gap: 4 },
  stepSeg: { width: 20, height: 2, borderRadius: 1 },
  scroll: { paddingHorizontal: 16, paddingTop: 24, gap: 14 },
  titleBlock: { gap: 8, paddingHorizontal: 4 },
  title: { fontSize: 28, fontWeight: "800" as const, lineHeight: 36, letterSpacing: -0.5 },
  subtitle: { fontSize: 13, lineHeight: 20 },
  card: { borderWidth: 1, borderRadius: 8, padding: 16, gap: 12 },
  cardTop: { flexDirection: "row", alignItems: "center", gap: 7 },
  cardLabelBlue: { fontSize: 9, letterSpacing: 2.5, color: "#3A7BD5", fontWeight: "700" as const },
  cardHint: { fontSize: 12, lineHeight: 17 },
  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
  },
  optionIcon: {
    width: 38,
    height: 38,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  optionText: { flex: 1, gap: 3 },
  optionLabel: { fontSize: 12, fontWeight: "700" as const, letterSpacing: 1 },
  optionDesc: { fontSize: 11, lineHeight: 16 },
  radioOuter: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  radioInner: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#3A7BD5",
  },
  notice: {
    flexDirection: "row",
    gap: 10,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: "flex-start",
  },
  noticeText: { flex: 1, fontSize: 12, lineHeight: 18 },
  footer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  nextBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 16,
    gap: 8,
  },
  nextText: { fontSize: 12, fontWeight: "700" as const, letterSpacing: 3 },
});
