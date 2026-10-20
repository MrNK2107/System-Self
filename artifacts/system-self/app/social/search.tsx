// Find players: public players by username, semi-public players by codename. Anonymous players cannot be found.
import React, { useState } from "react";
import { ActivityIndicator, Text } from "react-native";
import { router } from "expo-router";
import { SOCIAL_SEARCH_MIN_CHARS } from "@workspace/contracts";
import { AuthField } from "@/components/AuthField";
import { CodenameCard } from "@/components/CodenameCard";
import { PlayerRow } from "@/components/PlayerRow";
import { Group, Notice } from "@/components/arena/parts";
import { ListRow } from "@/components/ui/ListRow";
import { Screen } from "@/components/ui/Screen";
import { type } from "@/constants/type";
import { useColors } from "@/hooks/useColors";
import { useGameStateQuery } from "@/hooks/useGameState";
import { useSearchQuery } from "@/hooks/useSocial";
import { describeSocialError, normalizeSearchQuery } from "@/lib/social/social";

export default function SocialSearchScreen() {
  const colors = useColors();
  const [text, setText] = useState("");
  const q = useSearchQuery(text);
  const ready = normalizeSearchQuery(text) !== null;
  const results = ready ? (q.data ?? []) : [];
  const me = useGameStateQuery().data?.profile;
  const myCodename = me?.publicCodename;

  return (
    <Screen title="Find players" back>
      <AuthField
        label="USERNAME OR CODENAME"
        value={text}
        onChangeText={setText}
        placeholder={`${SOCIAL_SEARCH_MIN_CHARS}+ characters`}
        returnKeyType="search"
        autoFocus
      />
      {!ready ? (
        <Text style={[type.body, { color: colors.mutedForeground }]}>
          Public players by username, semi-public players by codename. Anonymous players cannot be found.
        </Text>
      ) : q.isError ? (
        <Notice message={describeSocialError(q.error)} onRetry={() => void q.refetch()} />
      ) : q.isPending ? (
        <ActivityIndicator color={colors.primary} />
      ) : results.length === 0 ? (
        <Notice tone="info" message="No players found." />
      ) : (
        <Group>
          {results.map((p) => (
            <PlayerRow key={p.handle} player={p} onPress={() => router.push({ pathname: "/social/profile/[handle]", params: { handle: p.handle } })} />
          ))}
        </Group>
      )}
      <Group>
        <ListRow title="Following" subtitle="Players you follow" chevron onPress={() => router.push("/social/following")} />
        <ListRow title="Party of Two" subtitle="Your one training partner" chevron onPress={() => router.push("/duo")} />
      </Group>
      {myCodename ? <CodenameCard codename={myCodename} identity={me?.identitySetting} /> : null}
    </Screen>
  );
}
