import { router } from "expo-router";
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "@/components/ui/Button";
import { SystemWindow } from "@/components/ui/SystemWindow";
import { fonts, space, type } from "@/constants/type";
import { useColors } from "@/hooks/useColors";

const DOMAINS = ["BODY", "MIND", "WEALTH", "SOCIAL", "DISCIPLINE"] as const;
const RANKS = ["E", "D", "C", "B", "A", "S"] as const;

/** First screen for a signed-out user: what this is, then BEGIN (sign up) or sign in. */
export default function WelcomeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        s.root,
        { backgroundColor: colors.background, paddingTop: insets.top + space.xl, paddingBottom: insets.bottom + space.lg },
      ]}
    >
      <Text style={[type.label, { color: colors.mutedForeground }]}>SYSTEM // SELF</Text>

      <View style={s.hero}>
        <Text style={[s.headline, { color: colors.foreground }]} accessibilityRole="header">
          {"YOU HAVE BEEN\nSELECTED."}
        </Text>

        <SystemWindow title="NOTICE">
          <Text style={[type.body, { color: colors.foreground }]}>
            Every day you log what you did. THE SYSTEM scores it, sets your quests and ranks you.
          </Text>
          <Text style={[type.body, { color: colors.mutedForeground }]}>
            Rank moves only on sustained effort: 14 days to rise, 7 to fall.
          </Text>
        </SystemWindow>

        <View style={s.rows}>
          <View style={s.row} accessibilityLabel="Five domains: body, mind, wealth, social, discipline">
            {DOMAINS.map((d) => (
              <Text key={d} style={[type.label, { color: colors.subtle }]}>
                {d}
              </Text>
            ))}
          </View>
          <View style={s.ranks} accessibilityLabel="Ranks from E to S">
            {RANKS.map((r) => (
              <Text key={r} style={[s.rank, { color: colors.rank[r] }]}>
                {r}
              </Text>
            ))}
          </View>
        </View>
      </View>

      <View style={s.actions}>
        <Button label="BEGIN" onPress={() => router.push("/auth/sign-up")} block />
        <Button label="I HAVE AN ACCOUNT" variant="text" onPress={() => router.push("/auth/sign-in")} block />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: space.lg, justifyContent: "space-between" },
  hero: { gap: space.xl },
  headline: { fontFamily: fonts.displayBold, fontSize: 36, lineHeight: 42 },
  rows: { gap: space.md },
  row: { flexDirection: "row", justifyContent: "space-between" },
  ranks: { flexDirection: "row", justifyContent: "space-between" },
  rank: { fontFamily: fonts.displayBold, fontSize: 28, lineHeight: 32 },
  actions: { gap: space.sm },
});
