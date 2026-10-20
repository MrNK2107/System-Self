// /clan: the Arena's Clan panel on its own screen (deep links and notifications land here).
import React from "react";

import { ClanPanel } from "@/components/arena/ClanPanel";
import { usePullRefresh } from "@/components/arena/parts";
import { Screen } from "@/components/ui/Screen";

export default function ClanScreen() {
  const refresh = usePullRefresh();
  return (
    <Screen title="Clan" back refreshing={refresh.refreshing} onRefresh={refresh.onRefresh}>
      <ClanPanel />
    </Screen>
  );
}
