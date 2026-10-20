// Join a clan: by invite code, or by picking one from search (empty search lists clans by rank). Joining is free.
import React, { useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { router } from "expo-router";
import type { ClanSummary } from "@workspace/contracts";
import { AuthField } from "@/components/AuthField";
import { AuthButton, AuthNotice, AuthShell } from "@/components/AuthShell";
import { useColors } from "@/hooks/useColors";
import { useClanActions, useClanSearchQuery } from "@/hooks/useClan";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { CLAN_SEARCH_DEBOUNCE_MS, SYNC_PENDING_MESSAGE, clanLabel, clanStatusLine, describeClanError, isFull, normalizeInviteCode } from "@/lib/clan/clan";
import type { MutationResult } from "@/lib/game/actions";

function ClanRow({ clan, onJoin, disabled }: { clan: ClanSummary; onJoin: () => void; disabled: boolean }) {
  const colors = useColors();
  const full = isFull(clan);
  return (
    <View style={[s.row, { borderColor: colors.border, backgroundColor: colors.card }]}>
      <View style={s.body}>
        <Text style={[s.name, { color: colors.foreground }]} numberOfLines={1}>
          {clanLabel(clan)}
        </Text>
        <Text style={[s.meta, { color: colors.mutedForeground }]}>{clanStatusLine(clan)}</Text>
      </View>
      <TouchableOpacity
        onPress={onJoin}
        disabled={disabled || full}
        accessibilityRole="button"
        accessibilityLabel={full ? `${clan.name} is full` : `Join ${clan.name}`}
        style={[s.join, { borderColor: full ? colors.border : colors.primary }]}
      >
        <Text style={[s.joinText, { color: full ? colors.mutedForeground : colors.primary }]}>{full ? "FULL" : "JOIN"}</Text>
      </TouchableOpacity>
    </View>
  );
}

export default function JoinClanScreen() {
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
    <AuthShell tag="CLAN" title="Join a clan" subtitle="One clan per operator. Inside a clan, members see your username." back>
      <AuthField label="INVITE CODE" value={code} onChangeText={(t) => setCode(normalizeInviteCode(t))} placeholder="8 characters" autoCapitalize="characters" mono />
      <AuthButton label="JOIN BY CODE" onPress={() => void attempt(() => actions.joinByCode(code))} loading={busy} disabled={code.length < 4} />
      {error ? <AuthNotice message={error} /> : null}
      <AuthField label="SEARCH CLANS" value={text} onChangeText={setText} placeholder="Name or tag" returnKeyType="search" />
      {search.isError ? (
        <AuthNotice message={describeClanError(search.error)} onRetry={() => void search.refetch()} />
      ) : search.isPending ? (
        <AuthNotice tone="info" message="Searching." />
      ) : results.length === 0 ? (
        <AuthNotice tone="info" message="No clans found." />
      ) : (
        <View style={s.list}>
          {results.map((c) => (
            <ClanRow key={c.id} clan={c} disabled={busy} onJoin={() => void attempt(() => actions.joinById(c.id))} />
          ))}
        </View>
      )}
    </AuthShell>
  );
}

const s = StyleSheet.create({
  list: { gap: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderRadius: 4, padding: 12 },
  body: { flex: 1, gap: 3 },
  name: { fontSize: 13, fontWeight: "800" as const, letterSpacing: 1 },
  meta: { fontSize: 10, lineHeight: 14, letterSpacing: 0.5 },
  join: { borderWidth: 1, borderRadius: 3, paddingHorizontal: 12, paddingVertical: 6 },
  joinText: { fontSize: 10, fontWeight: "800" as const, letterSpacing: 2 },
});
