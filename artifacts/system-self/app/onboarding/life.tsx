import { router, useLocalSearchParams } from "expo-router";
import React, { useState } from "react";

import { OnboardingFrame, OptionList, OptionRow } from "@/components/onboarding/OnboardingFrame";
import type { LifeContext } from "@workspace/contracts";
import { lifeContext as lifeContextDef } from "@workspace/engine";
import { lifeContextOptions } from "@/lib/game/life";

export default function LifeScreen() {
  const params = useLocalSearchParams();
  const [life, setLife] = useState<LifeContext>("student");

  const handleNext = () => {
    router.push({ pathname: "/onboarding/schedule", params: { ...params, lifeContext: life } });
  };

  return (
    <OnboardingFrame
      step="life"
      onBack={() => router.back()}
      title="What does your day look like?"
      subtitle="This shapes your quests, never your score. Change it any time in Settings."
      action={{ label: "Continue", onPress: handleNext }}
    >
      <OptionList>
        {lifeContextOptions().map((opt) => (
          <OptionRow
            key={opt.key}
            title={opt.label}
            subtitle={lifeContextDef(opt.key).blurb}
            selected={life === opt.key}
            onPress={() => setLife(opt.key)}
          />
        ))}
      </OptionList>
    </OnboardingFrame>
  );
}
