import { router } from "expo-router";
import React from "react";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SystemLines } from "@/components/onboarding/SystemLines";
import { Button } from "@/components/ui/Button";
import { SystemWindow } from "@/components/ui/SystemWindow";
import { space } from "@/constants/type";
import { useColors } from "@/hooks/useColors";

// PRD §21, screen 1: THE SYSTEM speaks. No logo, no welcome tour.
const LINES = [
  "You opened this app for a reason.",
  "We're going to find out if you're serious about it.",
  "Answer honestly. These answers set your baseline.",
] as const;

export default function OnboardingIntro() {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  return (
    <View style={[s.root, { backgroundColor: colors.background, paddingTop: insets.top + space.xl, paddingBottom: insets.bottom + space.md }]}>
      <View style={s.center}>
        <SystemWindow title="THE SYSTEM">
          <SystemLines lines={LINES} />
        </SystemWindow>
      </View>
      <Button label="Begin" onPress={() => router.push("/onboarding/assessment")} block />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: space.md, gap: space.lg },
  center: { flex: 1, justifyContent: "center" },
});
