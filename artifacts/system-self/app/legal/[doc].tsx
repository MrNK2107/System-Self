import { router, useLocalSearchParams } from "expo-router";
import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { AuthButton, AuthShell } from "@/components/AuthShell";
import { MarkdownView } from "@/components/MarkdownView";
import { useColors } from "@/hooks/useColors";
import { LEGAL_DOCS } from "@/lib/legal/documents.generated";

const TITLES: Record<keyof typeof LEGAL_DOCS, string> = { terms: "TERMS", privacy: "PRIVACY POLICY", licenses: "OPEN-SOURCE LICENCES" };
/** The generated licence list is not a legal draft; the policy and terms are until review (HOLD H-06). */
const DRAFTS = new Set<string>(["terms", "privacy"]);

const isDoc = (v: unknown): v is keyof typeof LEGAL_DOCS => typeof v === "string" && Object.prototype.hasOwnProperty.call(LEGAL_DOCS, v);

// The text is bundled at build time from docs/legal/*.md (scripts/gen-legal.mjs). Terms and privacy are DRAFTS until legal
// review (HOLD H-06); the open-source licence list is generated from the dependencies (scripts/gen-notices.mjs).
export default function LegalScreen() {
  const colors = useColors();
  const { doc } = useLocalSearchParams<{ doc?: string }>();
  const key = isDoc(doc) ? doc : null;

  return (
    <AuthShell tag="LEGAL" title={key ? TITLES[key] : "DOCUMENT"} back>
      {key && !DRAFTS.has(key) ? null : (
        <View style={[styles.draft, { borderColor: colors.border }]} accessibilityRole="alert">
          <Text style={[styles.draftText, { color: colors.mutedForeground }]}>DRAFT — pending legal review</Text>
        </View>
      )}
      {key ? <MarkdownView source={LEGAL_DOCS[key]} /> : <Text style={[styles.body, { color: colors.mutedForeground }]}>This document does not exist.</Text>}
      <AuthButton label="BACK" onPress={() => router.back()} />
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  draft: { borderWidth: 1, borderRadius: 4, paddingVertical: 10, alignItems: "center" },
  draftText: { fontSize: 12, fontWeight: "700" as const, letterSpacing: 2, textAlign: "center" as const, fontFamily: "monospace" },
  body: { fontSize: 13, lineHeight: 20 },
});
