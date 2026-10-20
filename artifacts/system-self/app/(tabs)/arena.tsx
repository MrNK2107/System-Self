import { router } from "expo-router";
import React from "react";

import { ListRow } from "@/components/ui/ListRow";
import { Screen } from "@/components/ui/Screen";

export default function ArenaTab() {
  return (
    <Screen title="Arena" tab>
      <ListRow title="Rivals" chevron onPress={() => router.push("/rivals")} />
      <ListRow title="Clan" chevron onPress={() => router.push("/clan")} />
      <ListRow title="Challenges" chevron onPress={() => router.push("/challenges")} />
    </Screen>
  );
}
