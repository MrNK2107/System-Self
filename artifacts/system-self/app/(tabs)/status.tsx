import { router } from "expo-router";
import React from "react";

import { ListRow } from "@/components/ui/ListRow";
import { Screen } from "@/components/ui/Screen";

export default function StatusTab() {
  return (
    <Screen title="Status" tab>
      <ListRow title="Stats" chevron onPress={() => router.push("/stats")} />
      <ListRow title="Gym" chevron onPress={() => router.push("/gym")} />
      <ListRow title="Log history" chevron onPress={() => router.push("/history")} />
      <ListRow title="Settings" chevron onPress={() => router.push("/settings")} />
    </Screen>
  );
}
