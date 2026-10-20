// Join a clan: by invite code, or by picking one from search (empty search lists clans by rank). Joining is free.
import React, { useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import type { ClanSummary } from "@workspace/contracts";
import { AuthField } from "@/components/AuthField";
import { Group, Notice, Section } from "@/components/arena/parts";
import { Button } from "@/components/ui/Button";
import { ListRow } from "@/components/ui/ListRow";
import { Screen } from "@/components/ui/Screen";
import { space, type } from "@/constants/type";
import { useColors } from "@/hooks/useColors";
import { useClanActions, useClanSearchQuery } from "@/hooks/useClan";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { CLAN_SEARCH_DEBOUNCE_MS, SYNC_PENDING_MESSAGE, clanLabel, clanStatusLine, describeClanError, isFull, normalizeInviteCode } from "@/lib/clan/clan";
import type { MutationResult } from "@/lib/game/actions";

function ClanRow({ clan, onJoin, disabled }: { clan: ClanSummary; onJoin: () => void; disabled: boolean }) {
  const colors = useColors();
  const full = isFull(clan);
  return (
    <ListRow
      title={clanLabel(clan)}
      subtitle={clanStatusLine(clan)}
      trailing={
        full ? (
          <Text style={[type.label, { color: colors.subtle }]}>FULL</Text>
        ) : (
          <Button label="Join" variant="text" disabled={disabled} onPress={onJoin} accessibilityLabel={`Join ${clan.name}`} />
        )
      }
      accessibilityLabel={full ? `${clan.name} is full` : undefined}
    />
  );
}

export default function JoinClanScreen() {
  const colors = useColors();
  const actions = useClanActions();
  const [code, setCode] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const search = useClanSearchQuery(useDebouncedValue(text, CLAN_SEARCH_DEBOUNCE_MS));

  const attempt = async (send: () => Promise<MutationResult<unknown>>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await send();
      if (!r.ok) setError(SYNC_PENDING_MESSAGE);
      else router.replace({ pathname: "/(tabs)/arena", params: { tab: "clan" } });
    } catch (e) {
      setError(describeClanError(e));
    } finally {
      setBusy(false);
    }
  };

  const results = search.data ?? [];

  return (
    <Screen title="Join a clan" back>
      <Text style={[type.body, { color: colors.mutedForeground }]}>One clan per operator. Inside a clan, members see your username.</Text>
      <View style={s.form}>
        <AuthField label="INVITE CODE" value={code} onChangeText={(t) => setCode(normalizeInviteCode(t))} placeholder="8 characters" autoCapitalize="characters" />
        <Button label="Join with code" block loading={busy} disabled={code.length < 4} onPress={() => void attempt(() => actions.joinByCode(code))} />
        {error ? <Notice message={error} /> : null}
      </View>
      <Section label="Or find a clan">
        <AuthField label="SEARCH CLANS" value={text} onChangeText={setText} placeholder="Name or tag" returnKeyType="search" />
        {search.isError ? (
          <Notice message={describeClanError(search.error)} onRetry={() => void search.refetch()} />
        ) : search.isPending ? (
          <ActivityIndicator color={colors.primary} />
        ) : results.length === 0 ? (
          <Notice tone="info" message="No clans found." />
        ) : (
          <Group>
            {results.map((c) => (
              <ClanRow key={c.id} clan={c} disabled={busy} onJoin={() => void attempt(() => actions.joinById(c.id))} />
            ))}
          </Group>
        )}
      </Section>
    </Screen>
  );
}

const s = StyleSheet.create({
  form: { gap: space.md },
});
