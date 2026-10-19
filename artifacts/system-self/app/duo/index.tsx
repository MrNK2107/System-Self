// Party of Two: your one partner, the last 7 days of check-ins, the invites waiting on you or on them, and leaving.
// Inside a duo both of you see usernames; nothing here scores. Invites start from a player's profile.
import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { AuthButton, AuthLink, AuthNotice, AuthShell } from "@/components/AuthShell";
import { DuoCheckinButtons } from "@/components/DuoCard";
import { RankBadge } from "@/components/RankBadge";
import { SettingsCard } from "@/components/SettingsParts";
import { useColors } from "@/hooks/useColors";
import { useDuoActions, useDuoQuery } from "@/hooks/useDuo";
import { checkinLine, describeDuoError } from "@/lib/duo/duo";
import type { MutationResult } from "@/lib/game/actions";
import { profileSummary } from "@/lib/social/social";

const SYNC_PENDING = "Queued entries have not reached the System yet. Retry shortly.";

export default function DuoScreen() {
  const colors = useColors();
  const q = useDuoQuery();
  const actions = useDuoActions();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);

  const attempt = async (send: () => Promise<MutationResult<unknown>>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await send();
      if (!r.ok) setError(SYNC_PENDING);
      else setConfirmLeave(false);
    } catch (e) {
      setError(describeDuoError(e));
    } finally {
      setBusy(false);
    }
  };

  const view = q.data;
  const now = new Date();
  const incoming = view?.pendingInvites.filter((i) => i.direction === "incoming") ?? [];
  const outgoing = view?.pendingInvites.filter((i) => i.direction === "outgoing") ?? [];
  const summary = view?.partner ? profileSummary(view.partner) : null;
  const label = (text: string) => <Text style={[s.section, { color: colors.mutedForeground }]}>{text}</Text>;

  return (
    <AuthShell tag="PARTY OF TWO" title="Party of two" subtitle="One partner. You see each other's check-ins. No score effect." back>
      {error ? <AuthNotice message={error} /> : null}
      {q.isError && !view ? (
        <AuthNotice message={describeDuoError(q.error)} onRetry={() => void q.refetch()} />
      ) : !view ? (
        <AuthNotice tone="info" message="Loading." />
      ) : (
        <>
          {view.partner && summary ? (
            <>
              <SettingsCard>
                <View style={s.panel}>
                  <View style={s.rankRow}>
                    <RankBadge rank={view.partner.rank} size="md" />
                    <View style={s.rankText}>
                      <Text style={[s.title, { color: colors.foreground }]}>{view.partner.handle}</Text>
                      <Text style={[s.hint, { color: colors.mutedForeground }]}>{summary.rankLine}</Text>
                      <Text style={[s.hint, { color: colors.mutedForeground }]}>{summary.trajectoryLine}</Text>
                    </View>
                  </View>
                </View>
              </SettingsCard>
              <DuoCheckinButtons />
              {label("LAST 7 DAYS")}
              {view.checkins.length === 0 ? (
                <Text style={[s.hint, { color: colors.mutedForeground }]}>No check-ins yet. Walk in together.</Text>
              ) : (
                view.checkins.map((c) => (
                  <Text key={c.id} style={[s.line, { color: c.fromMe ? colors.mutedForeground : colors.foreground }]}>
                    {checkinLine(c, view.partner!.handle, now)}
                  </Text>
                ))
              )}
              {confirmLeave ? (
                <View style={s.confirm}>
                  <Text style={[s.hint, { color: colors.mutedForeground }]}>Leaving ends the duo for both of you and clears its check-ins.</Text>
                  <AuthButton label="CONFIRM LEAVE" loading={busy} onPress={() => void attempt(() => actions.leave())} />
                  <AuthLink label="CANCEL" onPress={() => setConfirmLeave(false)} />
                </View>
              ) : (
                <AuthLink label="LEAVE PARTY OF TWO" onPress={() => setConfirmLeave(true)} />
              )}
            </>
          ) : (
            <>
              {incoming.length > 0 ? label("INVITES") : null}
              {incoming.map((i) => (
                <SettingsCard key={i.id}>
                  <View style={s.panel}>
                    <Text style={[s.title, { color: colors.foreground }]}>{i.handle} invited you.</Text>
                    <AuthButton label="ACCEPT" loading={busy} onPress={() => void attempt(() => actions.answer(i.id, "accept"))} />
                    <AuthLink label="DECLINE" onPress={() => void attempt(() => actions.answer(i.id, "decline"))} />
                  </View>
                </SettingsCard>
              ))}
              {outgoing.length > 0 ? label("SENT") : null}
              {outgoing.map((i) => (
                <Text key={i.id} style={[s.line, { color: colors.mutedForeground }]}>
                  {i.handle} // waiting for an answer
                </Text>
              ))}
              {incoming.length === 0 && outgoing.length === 0 ? (
                <AuthNotice tone="info" message="No partner. Open a player's profile to invite them." />
              ) : null}
            </>
          )}
        </>
      )}
    </AuthShell>
  );
}

const s = StyleSheet.create({
  section: { fontSize: 10, letterSpacing: 2, fontWeight: "800" as const, marginTop: 6 },
  panel: { paddingVertical: 14, gap: 10 },
  rankRow: { flexDirection: "row", alignItems: "center", gap: 14 },
  rankText: { gap: 3, flex: 1 },
  title: { fontSize: 14, fontWeight: "700" as const, letterSpacing: 0.5 },
  line: { fontSize: 11, letterSpacing: 1, fontWeight: "700" as const },
  hint: { fontSize: 10, letterSpacing: 1.5, fontWeight: "600" as const },
  confirm: { gap: 8 },
});
