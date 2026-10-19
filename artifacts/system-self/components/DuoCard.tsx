// Dashboard card for the Party of Two: the partner's handle, the last check-ins and the three check-in buttons.
// Nothing here scores: a check-in is a message to one person. With no duo the card only appears while an invite waits.
import React, { useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { router } from "expo-router";
import type { DuoCheckinKind } from "@workspace/contracts";
import { useColors } from "@/hooks/useColors";
import { useDuoActions, useDuoQuery } from "@/hooks/useDuo";
import { DUO_BUTTONS, checkinLine, describeDuoError, hasDuoActivity, incomingInvites, latestCheckins } from "@/lib/duo/duo";

const SYNC_PENDING = "Queued entries have not reached the System yet. Retry shortly.";
const DASHBOARD_CHECKINS = 3;

/** The GOING NOW / CHECKED IN / DONE buttons with their own busy and error state. */
export function DuoCheckinButtons() {
  const colors = useColors();
  const actions = useDuoActions();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async (kind: DuoCheckinKind) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await actions.checkin(kind);
      if (!r.ok) setError(SYNC_PENDING);
    } catch (e) {
      setError(describeDuoError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={s.gap}>
      <View style={s.buttons}>
        {DUO_BUTTONS.map((b) => (
          <TouchableOpacity
            key={b.kind}
            onPress={() => void send(b.kind)}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={`Tell your partner: ${b.label.toLowerCase()}`}
            style={[s.button, { borderColor: colors.primary, opacity: busy ? 0.5 : 1 }]}
          >
            <Text style={[s.buttonText, { color: colors.primary }]}>{b.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {error ? (
        <Text style={[s.error, { color: colors.destructive }]} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

export function DuoCard() {
  const colors = useColors();
  const q = useDuoQuery();
  const view = q.data;
  if (!hasDuoActivity(view) || !view) return null;
  const now = new Date();

  if (!view.partner) {
    const first = incomingInvites(view)[0]!;
    return (
      <TouchableOpacity
        onPress={() => router.push("/duo")}
        accessibilityRole="button"
        style={[s.card, { borderColor: colors.primary + "60", backgroundColor: colors.card }]}
      >
        <Text style={[s.header, { color: colors.primary }]}>PARTY OF TWO</Text>
        <Text style={[s.title, { color: colors.foreground }]}>{first.handle} invited you.</Text>
        <Text style={[s.meta, { color: colors.mutedForeground }]}>Open to answer. No score effect.</Text>
      </TouchableOpacity>
    );
  }

  const partner = view.partner;
  const recent = latestCheckins(view.checkins, DASHBOARD_CHECKINS);
  return (
    <View style={[s.card, { borderColor: colors.primary + "60", backgroundColor: colors.card }]}>
      <TouchableOpacity onPress={() => router.push("/duo")} accessibilityRole="button" accessibilityLabel="Open Party of Two">
        <Text style={[s.header, { color: colors.primary }]}>PARTY OF TWO</Text>
        <Text style={[s.title, { color: colors.foreground }]}>{partner.handle}</Text>
      </TouchableOpacity>
      {recent.length === 0 ? (
        <Text style={[s.meta, { color: colors.mutedForeground }]}>No check-ins yet. Walk in together.</Text>
      ) : (
        recent.map((c) => (
          <Text key={c.id} style={[s.meta, { color: colors.mutedForeground }]}>
            {checkinLine(c, partner.handle, now)}
          </Text>
        ))
      )}
      <DuoCheckinButtons />
    </View>
  );
}

const s = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 4, padding: 16, gap: 8 },
  header: { fontSize: 11, fontWeight: "800", letterSpacing: 2 },
  title: { fontSize: 15, fontWeight: "700", letterSpacing: 1 },
  meta: { fontSize: 11, letterSpacing: 0.5 },
  gap: { gap: 6 },
  buttons: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  button: { borderWidth: 1, borderRadius: 3, paddingHorizontal: 10, paddingVertical: 8 },
  buttonText: { fontSize: 10, fontWeight: "800", letterSpacing: 1.5 },
  error: { fontSize: 11 },
});
