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
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";

type IdentitySetting = "anonymous" | "semi-public" | "public";

const IDENTITY_OPTIONS: { value: IdentitySetting; label: string; description: string }[] = [
  {
    value: "anonymous",
    label: "ANONYMOUS",
    description: "Codename only. No clan affiliation shown externally.",
  },
  {
    value: "semi-public",
    label: "SEMI-PUBLIC",
    description: "Username visible within clan. Codename to rivals and public. Default.",
  },
  {
    value: "public",
    label: "PUBLIC",
    description: "Full username visible everywhere.",
  },
];

export default function IdentityScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams();

  const [username, setUsername] = useState("");
  const [identity, setIdentity] = useState<IdentitySetting>("semi-public");

  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);
  const canContinue = username.trim().length >= 3;

  const handleNext = () => {
    router.push({
      pathname: "/onboarding/calibrating",
      params: {
        ...params,
        username: username.trim(),
        identity,
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
          <Text style={[styles.step, { color: colors.mutedForeground }]}>IDENTITY SETUP</Text>
          <Text style={[styles.title, { color: colors.foreground }]}>Who are you here?</Text>
        </View>

        <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.label, { color: colors.mutedForeground }]}>USERNAME</Text>
          <TextInput
            style={[styles.input, { color: colors.foreground, borderColor: colors.border }]}
            placeholder="Choose your callsign"
            placeholderTextColor={colors.mutedForeground}
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={20}
          />
          <Text style={[styles.hint, { color: colors.mutedForeground }]}>
            This is how your clan sees you. Rivals see a codename.
          </Text>
        </View>

        <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.label, { color: colors.mutedForeground }]}>IDENTITY VISIBILITY</Text>
          {IDENTITY_OPTIONS.map(opt => (
            <TouchableOpacity
              key={opt.value}
              style={[
                styles.optionCard,
                {
                  borderColor: identity === opt.value ? colors.primary : colors.border,
                  backgroundColor: identity === opt.value ? colors.primary + "15" : "transparent",
                }
              ]}
              onPress={() => setIdentity(opt.value)}
              activeOpacity={0.7}
            >
              <View style={styles.optionHeader}>
                <View style={[styles.radio, {
                  borderColor: identity === opt.value ? colors.primary : colors.border,
                  backgroundColor: identity === opt.value ? colors.primary : "transparent",
                }]} />
                <Text style={[styles.optionLabel, { color: identity === opt.value ? colors.primary : colors.foreground }]}>
                  {opt.label}
                </Text>
              </View>
              <Text style={[styles.optionDesc, { color: colors.mutedForeground }]}>{opt.description}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={[styles.infoCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.infoTitle, { color: colors.foreground }]}>Within your clan, identity is mandatory.</Text>
          <Text style={[styles.infoText, { color: colors.mutedForeground }]}>
            Accountability requires identity. Your clan always sees your username, rank, and scores.
          </Text>
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
  section: { padding: 16, borderRadius: 4, borderWidth: 1, gap: 12 },
  label: { fontSize: 9, letterSpacing: 2, fontWeight: "600" as const },
  input: { borderWidth: 1, borderRadius: 4, padding: 12, fontSize: 16, letterSpacing: 1 },
  hint: { fontSize: 11, lineHeight: 16 },
  optionCard: { padding: 12, borderRadius: 2, borderWidth: 1, gap: 6 },
  optionHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  radio: { width: 14, height: 14, borderRadius: 7, borderWidth: 1.5 },
  optionLabel: { fontSize: 11, fontWeight: "700" as const, letterSpacing: 2 },
  optionDesc: { fontSize: 11, lineHeight: 16, paddingLeft: 22 },
  infoCard: { padding: 14, borderRadius: 4, borderWidth: 1, gap: 6 },
  infoTitle: { fontSize: 12, fontWeight: "600" as const, lineHeight: 18 },
  infoText: { fontSize: 11, lineHeight: 17 },
  footer: { paddingHorizontal: 20, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth },
  nextBtn: { padding: 16, alignItems: "center", borderRadius: 2 },
  nextBtnText: { fontSize: 11, fontWeight: "700" as const, letterSpacing: 3 },
});
