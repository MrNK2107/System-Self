// Ask a friend to vouch (spec 8.6): a clanmate, duo partner or someone you follow back confirms you did the quest.
// They can only vouch once their own quest today is proven.
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";

import { Button } from "@/components/ui/Button";
import { Screen } from "@/components/ui/Screen";
import { SystemWindow } from "@/components/ui/SystemWindow";
import { space, type } from "@/constants/type";
import { useApp } from "@/context/AppContext";
import { useColors } from "@/hooks/useColors";
import { ApiError, api } from "@/lib/api/client";
import { askVouch } from "@/lib/session/api";

export default function AskVouchScreen() {
  const { questId } = useLocalSearchParams<{ questId: string }>();
  const router = useRouter();
  const colors = useColors();
  const { quests } = useApp();
  const quest = quests.find((q) => q.id === questId) ?? null;
  const [handle, setHandle] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const send = async () => {
    if (!quest) return;
    setBusy(true);
    setError(null);
    try {
      await askVouch(api, quest.id, handle.trim().replace(/^@/, ""), note.trim());
      setSent(true);
    } catch (e) {
      setError(e instanceof ApiError && e.kind === "http" ? e.message : "THE SYSTEM could not send the request. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const input = [s.input, type.body, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.card }];

  return (
    <Screen title="Ask a friend" back>
      {quest ? (
        <SystemWindow title="VOUCH">
          <Text style={[type.title, { color: colors.foreground }]}>{quest.title}</Text>
          <Text style={[type.meta, { color: colors.mutedForeground }]}>
            A clanmate, your duo partner, or someone you follow back can confirm it. They must have proven their own quest
            today. Each person can vouch 3 times a week.
          </Text>
        </SystemWindow>
      ) : (
        <Text style={[type.body, { color: colors.mutedForeground }]}>This quest is no longer active.</Text>
      )}
      {quest && !sent ? (
        <View style={s.block}>
          <Text style={[type.label, { color: colors.subtle }]}>THEIR HANDLE</Text>
          <TextInput value={handle} onChangeText={setHandle} autoCapitalize="none" placeholder="codename" placeholderTextColor={colors.subtle} style={input} />
          <Text style={[type.label, { color: colors.subtle }]}>WHAT THEY SAW</Text>
          <TextInput
            value={note}
            onChangeText={setNote}
            maxLength={140}
            placeholder="e.g. Football with me, 6–8 pm"
            placeholderTextColor={colors.subtle}
            style={input}
          />
          {error ? <Text style={[type.meta, { color: colors.destructive }]}>{error}</Text> : null}
          <Button label={busy ? "SENDING…" : "SEND REQUEST"} onPress={() => void send()} disabled={busy || !handle.trim() || !note.trim()} block />
        </View>
      ) : null}
      {sent ? (
        <View style={s.block}>
          <Text style={[type.title, { color: colors.foreground }]}>Request sent.</Text>
          <Text style={[type.body, { color: colors.mutedForeground }]}>
            When they confirm, the quest completes. The request lapses in 24 hours.
          </Text>
          <Button label="DONE" variant="text" onPress={() => router.back()} block />
        </View>
      ) : null}
    </Screen>
  );
}

const s = StyleSheet.create({
  block: { gap: space.sm, marginTop: space.lg },
  input: { borderWidth: 1, borderRadius: 4, paddingHorizontal: space.md, paddingVertical: space.sm, minHeight: 48 },
});
