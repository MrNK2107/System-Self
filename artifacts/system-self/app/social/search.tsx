import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { SOCIAL_SEARCH_MIN_CHARS } from "@workspace/contracts";
import { AuthField } from "@/components/AuthField";
import { AuthLink, AuthNotice, AuthShell } from "@/components/AuthShell";
import { PlayerRow } from "@/components/PlayerRow";
import { useColors } from "@/hooks/useColors";
import { useSearchQuery } from "@/hooks/useSocial";
import { describeSocialError, normalizeSearchQuery } from "@/lib/social/social";

export default function SocialSearchScreen() {
  const colors = useColors();
  const [text, setText] = useState("");
  const q = useSearchQuery(text);
  const ready = normalizeSearchQuery(text) !== null;
  const results = ready ? (q.data ?? []) : [];

  return (
    <AuthShell tag="SEARCH" title="Find players" subtitle="Public and semi-public players only. Anonymous players cannot be found." back>
      <AuthField
        label="USERNAME"
        value={text}
        onChangeText={setText}
        placeholder={`${SOCIAL_SEARCH_MIN_CHARS}+ characters`}
        returnKeyType="search"
      />
      {!ready ? (
        <Text style={[s.hint, { color: colors.mutedForeground }]}>Type at least {SOCIAL_SEARCH_MIN_CHARS} characters.</Text>
      ) : q.isError ? (
        <AuthNotice message={describeSocialError(q.error)} onRetry={() => void q.refetch()} />
      ) : q.isPending ? (
        <AuthNotice tone="info" message="Searching." />
      ) : results.length === 0 ? (
        <AuthNotice tone="info" message="No players found." />
      ) : (
        <View style={s.list}>
          {results.map((p) => (
            <PlayerRow
              key={p.handle}
              player={p}
              onPress={() => router.push({ pathname: "/social/profile/[handle]", params: { handle: p.handle } })}
            />
          ))}
        </View>
      )}
      <AuthLink label="FOLLOWING" onPress={() => router.push("/social/following")} />
    </AuthShell>
  );
}

const s = StyleSheet.create({
  hint: { fontSize: 12, lineHeight: 18, paddingHorizontal: 4 },
  list: { gap: 8 },
});
