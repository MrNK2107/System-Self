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
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";

type IdentitySetting = "anonymous" | "semi-public" | "public";

const IDENTITY_OPTIONS: {
  value: IdentitySetting;
  label: string;
  description: string;
  icon: "eye-off" | "eye" | "globe";
}[] = [
  {
    value: "anonymous",
    label: "GHOST",
    description: "Codename only. No external affiliation visible. Maximum privacy.",
    icon: "eye-off",
  },
  {
    value: "semi-public",
    label: "OPERATIVE",
    description: "Username visible to your clan only. Rivals see a codename. Recommended.",
    icon: "eye",
  },
  {
    value: "public",
    label: "OPEN",
    description: "Full username visible everywhere. Full accountability.",
    icon: "globe",
  },
];

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

export default function IdentityScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams();

  const [username, setUsername] = useState("");
  const [identity, setIdentity] = useState<IdentitySetting>("semi-public");
  const [focused, setFocused] = useState(false);

  const topPad = insets.top + (Platform.OS === "web" ? 0 : 0);
  const canContinue = username.trim().length >= 3;

  const handleNext = () => {
    router.push({
      pathname: "/onboarding/calibrating",
      params: { ...params, username: username.trim(), identity },
    });
  };

  return (
    <KeyboardAvoidingView
      style={[s.container, { backgroundColor: colors.background }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      {/* Header */}
      <View style={[s.header, { paddingTop: topPad + 16, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={s.back}>
          <Feather name="chevron-left" size={20} color={colors.mutedForeground} />
        </TouchableOpacity>
        <View style={s.headerMid}>
          <Text style={s.headerTag}>IDENTITY SETUP</Text>
          <StepBadge step={1} />
        </View>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView
        contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 100 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Title */}
        <View style={s.titleBlock}>
          <Text style={[s.title, { color: colors.foreground }]}>
            Who are you{"\n"}
            <Text style={{ color: "#3A7BD5" }}>in here?</Text>
          </Text>
          <Text style={[s.subtitle, { color: colors.mutedForeground }]}>
            Your callsign is how your clan knows you. Pick something you'll own.
          </Text>
        </View>

        {/* Username input */}
        <View style={[s.card, { backgroundColor: colors.card, borderColor: focused ? "#3A7BD550" : colors.border }]}>
          <Text style={[s.cardLabel, { color: colors.mutedForeground }]}>CALLSIGN</Text>
          <View style={[s.inputWrap, { borderColor: focused ? "#3A7BD580" : colors.border, backgroundColor: focused ? "#3A7BD508" : "transparent" }]}>
            <Feather name="at-sign" size={16} color={focused ? "#3A7BD5" : colors.mutedForeground} />
            <TextInput
              style={[s.input, { color: colors.foreground }]}
              placeholder="Choose your callsign"
              placeholderTextColor={colors.mutedForeground}
              value={username}
              onChangeText={setUsername}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={20}
            />
            {username.length >= 3 && (
              <Feather name="check-circle" size={16} color="#4B8B6F" />
            )}
          </View>
          <Text style={[s.cardHint, { color: colors.mutedForeground }]}>
            3–20 characters. Rivals see a generated codename, not this.
          </Text>
        </View>

        {/* Identity visibility */}
        <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={s.cardTop}>
            <Feather name="shield" size={14} color="#3A7BD5" />
            <Text style={s.cardLabelBlue}>VISIBILITY LEVEL</Text>
          </View>
          <Text style={[s.cardHint, { color: colors.mutedForeground }]}>
            Who can see your real identity outside your clan?
          </Text>

          {IDENTITY_OPTIONS.map(opt => {
            const active = identity === opt.value;
            return (
              <TouchableOpacity
                key={opt.value}
                style={[
                  s.optionRow,
                  {
                    borderColor: active ? "#3A7BD560" : colors.border,
                    backgroundColor: active ? "#3A7BD510" : "transparent",
                  },
                ]}
                onPress={() => setIdentity(opt.value)}
                activeOpacity={0.75}
              >
                <View style={[s.optionIcon, { backgroundColor: active ? "#3A7BD520" : colors.muted }]}>
                  <Feather name={opt.icon} size={16} color={active ? "#3A7BD5" : colors.mutedForeground} />
                </View>
                <View style={s.optionText}>
                  <Text style={[s.optionLabel, { color: active ? "#3A7BD5" : colors.foreground }]}>
                    {opt.label}
                  </Text>
                  <Text style={[s.optionDesc, { color: colors.mutedForeground }]}>
                    {opt.description}
                  </Text>
                </View>
                <View style={[s.radioOuter, { borderColor: active ? "#3A7BD5" : colors.border }]}>
                  {active && <View style={s.radioInner} />}
                </View>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Clan notice */}
        <View style={[s.notice, { backgroundColor: "#3A7BD510", borderColor: "#3A7BD530" }]}>
          <Feather name="users" size={14} color="#3A7BD5" />
          <Text style={[s.noticeText, { color: colors.mutedForeground }]}>
            Within your clan, identity is always visible. Accountability requires it.
          </Text>
        </View>
      </ScrollView>

      {/* Footer */}
      <View style={[s.footer, { paddingBottom: insets.bottom + 16, borderTopColor: colors.border, backgroundColor: colors.background }]}>
        <TouchableOpacity
          onPress={handleNext}
          disabled={!canContinue}
          activeOpacity={0.85}
          style={{ borderRadius: 2, overflow: "hidden" }}
        >
          <LinearGradient
            colors={canContinue ? ["#3A7BD5", "#2860B4"] : ["#252830", "#252830"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={s.nextBtn}
          >
            <Text style={[s.nextText, { color: canContinue ? "#fff" : "#3A3D48" }]}>CONTINUE</Text>
            {canContinue && <Feather name="arrow-right" size={16} color="#fff" />}
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
  headerTag: { fontSize: 9, letterSpacing: 3, color: "#3A3D48", fontWeight: "700" as const },
  stepRow: { flexDirection: "row", gap: 4 },
  stepSeg: { width: 20, height: 2, borderRadius: 1 },
  scroll: { paddingHorizontal: 16, paddingTop: 24, gap: 14 },
  titleBlock: { gap: 8, paddingHorizontal: 4 },
  title: { fontSize: 28, fontWeight: "800" as const, lineHeight: 36, letterSpacing: -0.5 },
  subtitle: { fontSize: 13, lineHeight: 20 },
  card: { borderWidth: 1, borderRadius: 8, padding: 16, gap: 12 },
  cardTop: { flexDirection: "row", alignItems: "center", gap: 7 },
  cardLabel: { fontSize: 9, letterSpacing: 2.5, fontWeight: "700" as const },
  cardLabelBlue: { fontSize: 9, letterSpacing: 2.5, color: "#3A7BD5", fontWeight: "700" as const },
  cardHint: { fontSize: 12, lineHeight: 17 },
  inputWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  input: { flex: 1, fontSize: 16, letterSpacing: 0.5 },
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
