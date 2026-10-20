// PRO named challenge: pick a domain and a length, send it to one player (a followed user or a clanmate). The server
// answers 402 pro_required for free accounts, which shows the PRO lock instead of an error.
import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { RANKED_DOMAINS, type RankedDomain } from "@workspace/engine";
import { Chip, Notice } from "@/components/arena/parts";
import { ProLock } from "@/components/ProLock";
import { Button } from "@/components/ui/Button";
import { DOMAIN_COLORS } from "@/constants/domains";
import { space, type } from "@/constants/type";
import { useColors } from "@/hooks/useColors";
import { useChallengeActions } from "@/hooks/useChallenges";
import { CHALLENGE_DAYS, CHALLENGE_RULE, createOutcome, type ChallengeDraft } from "@/lib/challenges/challenges";

const SYNC_PENDING = "Queued entries have not reached the System yet. Retry shortly.";

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
    <View style={s.panel} accessibilityLabel={`Challenge ${opponent}`}>
      <Text style={[type.label, { color: colors.mutedForeground }]}>DOMAIN</Text>
      <View style={s.row}>
        {RANKED_DOMAINS.map((d) => (
          <Chip key={d} label={d} dot={DOMAIN_COLORS[d]} selected={d === domain} onPress={() => setDomain(d)} />
        ))}
      </View>
      <Text style={[type.label, { color: colors.mutedForeground }]}>LENGTH</Text>
      <View style={s.row}>
        {CHALLENGE_DAYS.map((n) => (
          <Chip key={n} label={`${n} days`} selected={n === days} onPress={() => setDays(n)} />
        ))}
      </View>
      <Text style={[type.meta, { color: colors.mutedForeground }]}>{CHALLENGE_RULE}</Text>
      {error ? <Notice message={error} /> : null}
      {sent ? <Notice tone="info" message="Challenge sent. They have 48 hours to answer. Logged." /> : null}
      <Button label={`Challenge ${opponent}`} block loading={busy} onPress={() => void send()} />
    </View>
  );
}

const s = StyleSheet.create({
  panel: { gap: space.sm },
  row: { flexDirection: "row", flexWrap: "wrap", gap: space.sm, marginBottom: space.xs },
});
