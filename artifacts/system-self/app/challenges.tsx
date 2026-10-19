// Named challenges: incoming (ACCEPT / IGNORE), sent, active with the live domain-gain comparison, and the closed ones.
// Only the two gains in the challenged domain are shown: no other score, never a hidden score.
import React, { useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import type { Challenge } from "@workspace/contracts";
import { AuthNotice, AuthShell } from "@/components/AuthShell";
import { ProLock } from "@/components/ProLock";
import { useColors } from "@/hooks/useColors";
import { useChallengeActions, useChallengesQuery } from "@/hooks/useChallenges";
import {
  CHALLENGE_RULE,
  challengeHeadline,
  describeChallengeError,
  gainLabel,
  groupChallenges,
  respondTimeLeft,
  standingLine,
  statusLine,
} from "@/lib/challenges/challenges";
import { isProRequired } from "@/lib/api/pro";
import type { MutationResult } from "@/lib/game/actions";

const SYNC_PENDING = "Queued entries have not reached the System yet. Retry shortly.";

function Card({ c, children }: { c: Challenge; children?: React.ReactNode }) {
  const colors = useColors();
  return (
    <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Text style={[s.headline, { color: colors.foreground }]}>{challengeHeadline(c)}</Text>
      {children}
    </View>
  );
}

function Btn({ label, onPress, disabled, tone }: { label: string; onPress: () => void; disabled: boolean; tone: "primary" | "muted" }) {
  const colors = useColors();
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={[s.btn, { borderColor: tone === "primary" ? colors.primary : colors.border, opacity: disabled ? 0.5 : 1 }]}
    >
      <Text style={[s.btnText, { color: tone === "primary" ? colors.primary : colors.mutedForeground }]}>{label}</Text>
    </TouchableOpacity>
  );
}

export default function ChallengesScreen() {
  const colors = useColors();
  const q = useChallengesQuery();
  const actions = useChallengeActions();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pro, setPro] = useState(false);

  const attempt = async (send: () => Promise<MutationResult<unknown>>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await send();
      if (!r.ok) setError(SYNC_PENDING);
    } catch (e) {
      if (isProRequired(e)) setPro(true);
      else setError(describeChallengeError(e));
    } finally {
      setBusy(false);
    }
  };

  const now = new Date();
  const groups = groupChallenges(q.data ?? []);
  const label = (text: string) => <Text style={[s.section, { color: colors.mutedForeground }]}>{text}</Text>;

  return (
    <AuthShell tag="CHALLENGES" title="Named challenges" subtitle={CHALLENGE_RULE} back>
      {pro ? <ProLock label="NAMED CHALLENGE" /> : null}
      {error ? <AuthNotice message={error} /> : null}
      {q.isError && !q.data ? (
        <AuthNotice message={describeChallengeError(q.error)} onRetry={() => void q.refetch()} />
      ) : !q.data ? (
        <AuthNotice tone="info" message="Loading." />
      ) : q.data.length === 0 ? (
        <AuthNotice tone="info" message="No challenges. Open a followed player or a clanmate to issue one." />
      ) : (
        <>
          {groups.incoming.length > 0 ? label("INCOMING") : null}
          {groups.incoming.map((c) => (
            <Card key={c.id} c={c}>
              <Text style={[s.line, { color: colors.mutedForeground }]}>
                {statusLine(c)} {respondTimeLeft(c.respondBy, now)}.
              </Text>
              <View style={s.actions}>
                <Btn label="ACCEPT" tone="primary" disabled={busy} onPress={() => void attempt(() => actions.accept(c.id))} />
                <Btn label="IGNORE" tone="muted" disabled={busy} onPress={() => void attempt(() => actions.ignore(c.id))} />
              </View>
            </Card>
          ))}
          {groups.active.length > 0 ? label("ACTIVE") : null}
          {groups.active.map((c) => (
            <Card key={c.id} c={c}>
              <View style={s.gains}>
                <Text style={[s.gain, { color: colors.foreground }]}>YOU {c.myGain === null ? "-" : gainLabel(c.myGain)}</Text>
                <Text style={[s.gain, { color: colors.foreground }]}>THEM {c.theirGain === null ? "-" : gainLabel(c.theirGain)}</Text>
              </View>
              <Text style={[s.line, { color: colors.primary }]}>{standingLine(c)}</Text>
              <Text style={[s.line, { color: colors.mutedForeground }]}>{statusLine(c)}</Text>
            </Card>
          ))}
          {groups.sent.length > 0 ? label("SENT") : null}
          {groups.sent.map((c) => (
            <Card key={c.id} c={c}>
              <Text style={[s.line, { color: colors.mutedForeground }]}>{statusLine(c)}</Text>
            </Card>
          ))}
          {groups.closed.length > 0 ? label("CLOSED") : null}
          {groups.closed.map((c) => (
            <Card key={c.id} c={c}>
              {c.status === "resolved" && c.myGain !== null && c.theirGain !== null ? (
                <Text style={[s.line, { color: colors.mutedForeground }]}>
                  YOU {gainLabel(c.myGain)}  THEM {gainLabel(c.theirGain)}
                </Text>
              ) : null}
              <Text style={[s.line, { color: colors.mutedForeground }]}>{statusLine(c)}</Text>
            </Card>
          ))}
        </>
      )}
    </AuthShell>
  );
}

const s = StyleSheet.create({
  section: { fontSize: 10, letterSpacing: 2, fontWeight: "800" as const, marginTop: 6 },
  card: { borderWidth: 1, borderRadius: 4, padding: 12, gap: 8 },
  headline: { fontSize: 13, fontWeight: "700" as const, letterSpacing: 0.5 },
  line: { fontSize: 10, letterSpacing: 1.5, fontWeight: "700" as const },
  gains: { flexDirection: "row", justifyContent: "space-between" },
  gain: { fontSize: 14, fontWeight: "800" as const, fontFamily: "SpaceMono" },
  actions: { flexDirection: "row", gap: 8 },
  btn: { borderWidth: 1, borderRadius: 3, paddingHorizontal: 14, paddingVertical: 8 },
  btnText: { fontSize: 10, fontWeight: "800" as const, letterSpacing: 2 },
});
