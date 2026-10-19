import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { AuthLink, AuthNotice, AuthShell } from "@/components/AuthShell";
import { PlayerRow } from "@/components/PlayerRow";
import { useColors } from "@/hooks/useColors";
import { useFollowersCountQuery, useFollowingQuery } from "@/hooks/useSocial";
import { describeSocialError } from "@/lib/social/social";

export default function FollowingScreen() {
  const colors = useColors();
  const following = useFollowingQuery();
  const followers = useFollowersCountQuery();
  const list = following.data ?? [];

  return (
    <AuthShell tag="FOLLOWING" title="Following" subtitle="Rank, trajectory and shadow. Nothing else is shared." back>
      <Text style={[s.count, { color: colors.mutedForeground }]}>
        {followers.data === undefined ? "" : `${followers.data} FOLLOWING YOU`}
      </Text>
      {following.isError ? (
        <AuthNotice message={describeSocialError(following.error)} onRetry={() => void following.refetch()} />
      ) : following.isPending ? (
        <AuthNotice tone="info" message="Loading." />
      ) : list.length === 0 ? (
        <AuthNotice tone="info" message="You follow no one. Search for players to follow." />
      ) : (
        <View style={s.list}>
          {list.map((p) => (
            <PlayerRow
              key={p.handle}
              player={p}
              onPress={() => router.push({ pathname: "/social/profile/[handle]", params: { handle: p.handle } })}
            />
          ))}
        </View>
      )}
      <AuthLink label="FIND PLAYERS" onPress={() => router.push("/social/search")} />
    </AuthShell>
  );
}

const s = StyleSheet.create({
  count: { fontSize: 10, letterSpacing: 2, fontWeight: "700" as const, paddingHorizontal: 4 },
  list: { gap: 8 },
});
