// Vouch requests waiting for this player (spec 8.6): confirm or deny each. Hidden when there are none.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { Button } from "@/components/ui/Button";
import { SystemWindow } from "@/components/ui/SystemWindow";
import { space, type } from "@/constants/type";
import { useColors } from "@/hooks/useColors";
import { ApiError, api } from "@/lib/api/client";
import { fetchIncomingVouches, respondVouch } from "@/lib/session/api";

export const INCOMING_VOUCHES_KEY = ["vouches", "incoming"] as const;

export function VouchInbox() {
  const colors = useColors();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: INCOMING_VOUCHES_KEY, queryFn: () => fetchIncomingVouches(api), refetchInterval: 60_000 });
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const items = q.data ?? [];
  if (items.length === 0 && !message) return null;

  const answer = async (id: string, confirm: boolean) => {
    setBusy(id);
    setMessage(null);
    try {
      const r = await respondVouch(api, id, confirm);
      setMessage(r.status === "confirmed" ? "Vouch recorded." : "Denied.");
    } catch (e) {
      setMessage(e instanceof ApiError && e.kind === "http" ? e.message : "THE SYSTEM could not record your answer.");
    } finally {
      setBusy(null);
      void qc.invalidateQueries({ queryKey: INCOMING_VOUCHES_KEY });
    }
  };

  return (
    <SystemWindow title={items.length === 1 ? "VOUCH REQUEST" : `${items.length} VOUCH REQUESTS`}>
      {items.map((v) => (
        <View key={v.id} style={s.item}>
          <Text style={[type.bodyStrong, { color: colors.foreground }]}>{`${v.from}: ${v.questTitle}`}</Text>
          <Text style={[type.body, { color: colors.mutedForeground }]}>{`"${v.note}"`}</Text>
          <View style={s.row}>
            <Button label="CONFIRM" onPress={() => void answer(v.id, true)} disabled={busy !== null} />
            <Button label="DENY" variant="text" onPress={() => void answer(v.id, false)} disabled={busy !== null} />
          </View>
        </View>
      ))}
      {message ? <Text style={[type.meta, { color: colors.warn }]}>{message}</Text> : null}
    </SystemWindow>
  );
}

const s = StyleSheet.create({
  item: { gap: space.xs },
  row: { flexDirection: "row", gap: space.sm },
});
