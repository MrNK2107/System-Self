// Placeholder paywall: every PRO lock links here. P7 replaces it with the real purchase flow (RevenueCat).
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { AuthLink, AuthShell } from "@/components/AuthShell";
import { useColors } from "@/hooks/useColors";

export default function PaywallScreen() {
  const colors = useColors();
  return (
    <AuthShell tag="PRO" title="SYSTEM // SELF PRO" subtitle="Coming soon." back>
      <View style={[s.card, { borderColor: colors.border, backgroundColor: colors.card }]}>
        <Text style={[s.line, { color: colors.foreground }]}>SYSTEM // SELF PRO — coming soon</Text>
        <Text style={[s.body, { color: colors.mutedForeground }]}>
          Clans, named challenges and Shame Mode are PRO features. Purchases open in a later release.
        </Text>
      </View>
      <AuthLink label="BACK" onPress={() => router.back()} />
    </AuthShell>
  );
}

const s = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 4, padding: 16, gap: 8 },
  line: { fontSize: 13, fontWeight: "700", letterSpacing: 1 },
  body: { fontSize: 12, lineHeight: 18 },
});
