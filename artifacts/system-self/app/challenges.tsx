// /challenges: the Arena's Challenges panel on its own screen (deep links and notifications land here).
import React from "react";

import { ChallengesPanel } from "@/components/arena/ChallengesPanel";
import { usePullRefresh } from "@/components/arena/parts";
import { Screen } from "@/components/ui/Screen";

export default function ChallengesScreen() {
  const refresh = usePullRefresh();
  return (
    <Screen title="Challenges" back refreshing={refresh.refreshing} onRefresh={refresh.onRefresh}>
      <ChallengesPanel />
    </Screen>
  );
}
