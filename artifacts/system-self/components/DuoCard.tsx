// Today card for the Party of Two: the partner's handle, the last check-ins and the three check-in buttons.
// Nothing here scores: a check-in is a message to one person. With no duo the card only appears while an invite waits.
import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import type { DuoCheckinKind } from "@workspace/contracts";
import { space, type } from "@/constants/type";
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
          <View key={b.kind} style={[s.chip, { backgroundColor: colors.muted }, busy && s.inactive]}>
            <Pressable
              onPress={() => void send(b.kind)}
              disabled={busy}
              android_ripple={{ color: "rgba(168,121,255,0.18)" }}
              accessibilityRole="button"
              accessibilityState={{ disabled: busy }}
              accessibilityLabel={`Tell your partner: ${b.label.toLowerCase()}`}
              style={s.chipPress}
            >
              <Text style={[type.label, { color: colors.primary }]} numberOfLines={1}>
                {b.label}
              </Text>
            </Pressable>
          </View>
        ))}
      </View>
      {error ? (
        <Text style={[type.meta, { color: colors.destructive }]} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

/** Pressable header of the card: title, subtitle and a chevron to the Party of Two screen. */
function Header({ title, subtitle, label }: { title: string; subtitle: string; label: string }) {
  const colors = useColors();
  return (
    <Pressable
      onPress={() => router.push("/duo")}
      accessibilityRole="button"
      accessibilityLabel={label}
      android_ripple={{ color: "rgba(168,121,255,0.12)" }}
      style={s.header}
    >
      <View style={s.headerText}>
        <Text style={[type.bodyStrong, { color: colors.foreground }]}>{title}</Text>
        <Text style={[type.meta, { color: colors.mutedForeground }]}>{subtitle}</Text>
      </View>
      <Feather name="chevron-right" size={20} color={colors.subtle} />
    </Pressable>
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
      <View style={[s.card, { borderColor: colors.border, backgroundColor: colors.card }]}>
        <Header title={`${first.handle} invited you to a Party of Two.`} subtitle="Open to answer. No score effect." label="Open Party of Two invite" />
      </View>
    );
  }

  const partner = view.partner;
  const recent = latestCheckins(view.checkins, DASHBOARD_CHECKINS);
  return (
    <View style={[s.card, { borderColor: colors.border, backgroundColor: colors.card }]}>
      <Header title={partner.handle} subtitle="Party of Two · no score effect" label="Open Party of Two" />
      <View style={s.body}>
        {recent.length === 0 ? (
          <Text style={[type.meta, { color: colors.mutedForeground }]}>No check-ins yet. Walk in together.</Text>
        ) : (
          recent.map((c) => (
            <Text key={c.id} style={[type.meta, { color: colors.mutedForeground }]}>
              {checkinLine(c, partner.handle, now)}
            </Text>
          ))
        )}
        <DuoCheckinButtons />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 4, overflow: "hidden" },
  header: { minHeight: 64, flexDirection: "row", alignItems: "center", gap: space.md, padding: space.md },
  headerText: { flex: 1, gap: 2 },
  body: { paddingHorizontal: space.md, paddingBottom: space.md, gap: space.sm },
  gap: { gap: space.sm, marginTop: space.xs },
  buttons: { flexDirection: "row", gap: space.sm },
  chip: { flex: 1, borderRadius: 4, overflow: "hidden" },
  chipPress: { minHeight: 48, alignItems: "center", justifyContent: "center", paddingHorizontal: space.xs },
  inactive: { opacity: 0.45 },
});
