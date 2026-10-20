import { router, useLocalSearchParams } from "expo-router";
import React, { useState } from "react";
import { Text } from "react-native";

import { OnboardingFrame, OptionList, OptionRow } from "@/components/onboarding/OnboardingFrame";
import { IDENTITY_OPTIONS, type IdentitySetting } from "@/constants/identity";
import { type } from "@/constants/type";
import { useColors } from "@/hooks/useColors";

/** One line per choice (the settings screen keeps the longer descriptions). */
const ONE_LINE: Record<IdentitySetting, string> = {
  anonymous: "Codename only, everywhere. Maximum privacy.",
  "semi-public": "Your clan sees your username. Rivals see a codename.",
  public: "Your username, everywhere. Full accountability.",
};

const titleCase = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

export default function IdentityScreen() {
  const colors = useColors();
  const params = useLocalSearchParams();
  const [identity, setIdentity] = useState<IdentitySetting>("semi-public");

  const handleNext = () => {
    router.push({ pathname: "/onboarding/life", params: { ...params, identity } });
  };

  return (
    <OnboardingFrame
      step="identity"
      onBack={() => router.back()}
      title="Who gets to see you?"
      subtitle="Your codename is already set. Decide who sees your username."
      action={{ label: "Continue", onPress: handleNext }}
    >
      <OptionList>
        {IDENTITY_OPTIONS.map((opt) => (
          <OptionRow
            key={opt.value}
            title={opt.value === "semi-public" ? `${titleCase(opt.label)} (recommended)` : titleCase(opt.label)}
            subtitle={ONE_LINE[opt.value]}
            selected={identity === opt.value}
            onPress={() => setIdentity(opt.value)}
          />
        ))}
      </OptionList>
      <Text style={[type.meta, { color: colors.mutedForeground }]}>
        Inside your clan, your username is always visible. Change this any time in Settings.
      </Text>
    </OnboardingFrame>
  );
}
