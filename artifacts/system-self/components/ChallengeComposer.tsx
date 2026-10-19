// PRO named challenge: pick a domain and a length, send it to one player (a followed user or a clanmate). The server
// answers 402 pro_required for free accounts, which shows the PRO lock instead of an error.
import React, { useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { RANKED_DOMAINS, type RankedDomain } from "@workspace/engine";
import { AuthButton, AuthNotice } from "@/components/AuthShell";
import { ProLock } from "@/components/ProLock";
import { useColors } from "@/hooks/useColors";
import { useChallengeActions } from "@/hooks/useChallenges";
import { CHALLENGE_DAYS, CHALLENGE_RULE, createOutcome, type ChallengeDraft } from "@/lib/challenges/challenges";

const SYNC_PENDING = "Queued entries have not reached the System yet. Retry shortly.";

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const colors = useColors();
  return (
    <TouchableOpacity
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={[s.chip, { borderColor: selected ? colors.primary : colors.border, backgroundColor: selected ? colors.primary + "20" : "transparent" }]}
    >
      <Text style={[s.chipText, { color: selected ? colors.primary : colors.mutedForeground }]}>{label}</Text>
    </TouchableOpacity>
  );
}

/** `opponent` is the handle exactly as shown to the viewer (a clanmate's username, or a followed player's handle). */
export function ChallengeComposer({ opponent }: { opponent: string }) {
  const colors = useColors();
  const actions = useChallengeActions();
  const [domain, setDomain] = useState<RankedDomain>("MIND");
  const [days, setDays] = useState<ChallengeDraft["days"]>(7);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pro, setPro] = useState(false);
  const [sent, setSent] = useState(false);

  const send = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setSent(false);
    try {
      const r = await actions.create(opponent, domain, days);
      if (!r.ok) setError(SYNC_PENDING);
      else setSent(true);
    } catch (e) {
      const out = createOutcome(e);
      if (out.kind === "pro") setPro(true);
      else setError(out.message);
    } finally {
      setBusy(false);
    }
  };

  if (pro) return <ProLock label="NAMED CHALLENGE" />;
  return (
    <View style={s.panel}>
      <Text style={[s.label, { color: colors.mutedForeground }]}>CHALLENGE {opponent.toUpperCase()}</Text>
      <View style={s.row}>
        {RANKED_DOMAINS.map((d) => (
          <Chip key={d} label={d} selected={d === domain} onPress={() => setDomain(d)} />
        ))}
      </View>
      <View style={s.row}>
        {CHALLENGE_DAYS.map((n) => (
          <Chip key={n} label={`${n} DAYS`} selected={n === days} onPress={() => setDays(n)} />
        ))}
      </View>
      <Text style={[s.hint, { color: colors.mutedForeground }]}>{CHALLENGE_RULE}</Text>
      {error ? <AuthNotice message={error} /> : null}
      {sent ? <AuthNotice tone="info" message="Challenge sent. They have 48 hours to answer. Logged." /> : null}
      <AuthButton label="SEND CHALLENGE" loading={busy} onPress={() => void send()} />
    </View>
  );
}

const s = StyleSheet.create({
  panel: { gap: 10 },
  label: { fontSize: 10, letterSpacing: 2, fontWeight: "800" as const },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { borderWidth: 1, borderRadius: 3, paddingHorizontal: 10, paddingVertical: 6 },
  chipText: { fontSize: 10, fontWeight: "800" as const, letterSpacing: 1.5 },
  hint: { fontSize: 10, letterSpacing: 1, fontWeight: "600" as const, lineHeight: 15 },
});
