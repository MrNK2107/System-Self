// Players the user follows. Rank, trajectory and shadow only; nothing else is shared.
import React from "react";
import { ActivityIndicator, Text } from "react-native";
import { router } from "expo-router";
import { PlayerRow } from "@/components/PlayerRow";
import { Group, Notice } from "@/components/arena/parts";
import { Button } from "@/components/ui/Button";
import { Screen } from "@/components/ui/Screen";
import { type } from "@/constants/type";
import { useColors } from "@/hooks/useColors";
import { useFollowersCountQuery, useFollowingQuery } from "@/hooks/useSocial";
import { describeSocialError } from "@/lib/social/social";

export default function FollowingScreen() {
  const colors = useColors();
  const following = useFollowingQuery();
  const followers = useFollowersCountQuery();
  const list = following.data ?? [];

  return (
    <Screen title="Following" back>
      <Text style={[type.meta, { color: colors.mutedForeground }]}>
        Rank, trajectory and shadow. Nothing else is shared.
        {followers.data === undefined ? "" : ` ${followers.data} following you.`}
      </Text>
      {following.isError ? (
        <Notice message={describeSocialError(following.error)} onRetry={() => void following.refetch()} />
      ) : following.isPending ? (
        <ActivityIndicator color={colors.primary} />
      ) : list.length === 0 ? (
        <>
          <Text style={[type.body, { color: colors.mutedForeground }]}>You follow no one yet.</Text>
          <Button label="Find players" block onPress={() => router.push("/social/search")} />
        </>
      ) : (
        <Group>
          {list.map((p) => (
            <PlayerRow key={p.handle} player={p} onPress={() => router.push({ pathname: "/social/profile/[handle]", params: { handle: p.handle } })} />
          ))}
        </Group>
      )}
    </Screen>
  );
}
