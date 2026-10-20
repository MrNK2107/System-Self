import { useLocalSearchParams } from "expo-router";
import React from "react";
import { Text } from "react-native";

import { MarkdownView } from "@/components/MarkdownView";
import { Screen } from "@/components/ui/Screen";
import { type } from "@/constants/type";
import { useColors } from "@/hooks/useColors";
import { LEGAL_DOCS } from "@/lib/legal/documents.generated";

const TITLES: Record<keyof typeof LEGAL_DOCS, string> = { terms: "Terms", privacy: "Privacy policy", licenses: "Open-source licences" };
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
    <Screen title={key ? TITLES[key] : "Document"} back>
      {key && !DRAFTS.has(key) ? null : (
        <Text style={[type.meta, { color: colors.warn }]} accessibilityRole="alert">
          Draft. Pending legal review.
        </Text>
      )}
      {key ? (
        <MarkdownView source={LEGAL_DOCS[key]} />
      ) : (
        <Text style={[type.body, { color: colors.mutedForeground }]}>This document does not exist.</Text>
      )}
    </Screen>
  );
}
