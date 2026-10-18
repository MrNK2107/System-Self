import { router, useLocalSearchParams } from "expo-router";
import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { AuthButton, AuthShell } from "@/components/AuthShell";
import { useColors } from "@/hooks/useColors";

const TITLES: Record<string, string> = { terms: "TERMS", privacy: "PRIVACY POLICY" };

// Placeholder until the real documents ship in P8.
export default function LegalScreen() {
  const colors = useColors();
  const { doc } = useLocalSearchParams<{ doc?: string }>();
  const title = TITLES[String(doc)] ?? "DOCUMENT";

  return (
    <AuthShell tag="LEGAL" title={title} back>
      <View style={[styles.draft, { borderColor: colors.border }]}>
        <Text style={[styles.draftText, { color: colors.mutedForeground }]}>DRAFT</Text>
      </View>
      <Text style={[styles.body, { color: colors.mutedForeground }]}>
        This document is not published yet. The final text will appear here before launch.
      </Text>
      <AuthButton label="BACK" onPress={() => router.back()} />
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  draft: { borderWidth: 1, borderRadius: 4, paddingVertical: 24, alignItems: "center" },
  draftText: { fontSize: 14, fontWeight: "700" as const, letterSpacing: 6, fontFamily: "monospace" },
  body: { fontSize: 13, lineHeight: 20 },
});
