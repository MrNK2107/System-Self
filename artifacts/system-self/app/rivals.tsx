// /rivals: the Arena's Rivals panel on its own screen (deep links and notifications land here).
import React from "react";

import { RivalsPanel } from "@/components/arena/RivalsPanel";
import { usePullRefresh } from "@/components/arena/parts";
import { Screen } from "@/components/ui/Screen";

export default function RivalsScreen() {
  const refresh = usePullRefresh();
  return (
    <Screen title="Rivals" back refreshing={refresh.refreshing} onRefresh={refresh.onRefresh}>
      <RivalsPanel />
    </Screen>
  );
}
