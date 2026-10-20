// Arena: who you are against. Rivals, Clan and Challenges as one segmented page; the panels are the same ones the
// /rivals, /clan and /challenges routes show (deep links keep working). `tab` picks the panel on entry (clan
// create/join redirect here with tab=clan).
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useState } from "react";

import { ChallengesPanel } from "@/components/arena/ChallengesPanel";
import { ClanPanel } from "@/components/arena/ClanPanel";
import { RivalsPanel } from "@/components/arena/RivalsPanel";
import { usePullRefresh } from "@/components/arena/parts";
import { IconButton, Screen } from "@/components/ui/Screen";
import { Segmented } from "@/components/ui/Segmented";

type Tab = "rivals" | "clan" | "challenges";
const TABS: { key: Tab; label: string }[] = [
  { key: "rivals", label: "Rivals" },
  { key: "clan", label: "Clan" },
  { key: "challenges", label: "Challenges" },
];
const asTab = (v: string | undefined): Tab | null => (v === "rivals" || v === "clan" || v === "challenges" ? v : null);

export default function ArenaTab() {
  const params = useLocalSearchParams<{ tab?: string }>();
  const [tab, setTab] = useState<Tab>(asTab(params.tab) ?? "rivals");
  const refresh = usePullRefresh();

  // A redirect with ?tab= while the Arena is already mounted still switches the panel.
  useEffect(() => {
    const next = asTab(params.tab);
    if (next) setTab(next);
  }, [params.tab]);

  return (
    <Screen
      title="Arena"
      tab
      action={<IconButton icon="search" label="Find players" onPress={() => router.push("/social/search")} />}
      refreshing={refresh.refreshing}
      onRefresh={refresh.onRefresh}
    >
      <Segmented options={TABS} value={tab} onChange={setTab} />
      {tab === "rivals" ? <RivalsPanel /> : tab === "clan" ? <ClanPanel /> : <ChallengesPanel />}
    </Screen>
  );
}
