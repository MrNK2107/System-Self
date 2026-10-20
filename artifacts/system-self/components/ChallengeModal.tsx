// Declare a 7-day rival challenge: pick a domain, see the matchup, send. A bottom sheet; the "declared"
// confirmation plays only after the server accepted the challenge, otherwise the reason shows under the button.
import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { RIVAL_CHALLENGE_DAYS } from "@workspace/contracts";

import { Chip, Notice, RankMark, Sheet, useToneColor } from "@/components/arena/parts";
import { Button } from "@/components/ui/Button";
import { SystemWindow } from "@/components/ui/SystemWindow";
import { ALL_DOMAINS as DOMAINS, DOMAIN_COLORS } from "@/constants/domains";
import { space, type } from "@/constants/type";
import { useApp, type Domain, type Rank } from "@/context/AppContext";
import { useColors } from "@/hooks/useColors";
import { gapFromUser, gapLine } from "@/lib/social/arena";
import { shortCodename } from "@/lib/social/rivals";

/** The rival as the challenge sheet shows it (all five ranked domains). */
export interface ChallengeTarget {
  codename: string;
  rank: Rank;
  trajectory: "up" | "stable" | "down";
  scores: Record<Domain, number>;
}

interface Props {
  visible: boolean;
  rival: ChallengeTarget | null;
  onClose: () => void;
  /** Sends the challenge; resolves null once the server confirmed it, else the reason it did not land. */
  onDeclare: (domain: Domain) => Promise<string | null>;
}

const TRAJECTORY_WORDS = { up: "Rising", stable: "Steady", down: "Falling" } as const;

export function ChallengeModal({ visible, rival, onClose, onDeclare }: Props) {
  const colors = useColors();
  const tone = useToneColor();
  const { domainScores } = useApp();
  const [selectedDomain, setSelectedDomain] = useState<Domain>("DISCIPLINE");
  const [declared, setDeclared] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (visible) {
      setDeclared(false);
      setSending(false);
      setError(null);
      setSelectedDomain("DISCIPLINE");
    }
  }, [visible]);
  useEffect(() => () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);

  if (!rival) return null;

  const userScore = domainScores.find((s) => s.domain === selectedDomain)?.score ?? 50;
  const rivalScore = rival.scores[selectedDomain] ?? 0;
  const gap = gapFromUser(userScore, rivalScore);

  const startDate = new Date();
  // The window is 7 local days including today.
  const endDate = new Date(Date.now() + (RIVAL_CHALLENGE_DAYS - 1) * 24 * 60 * 60 * 1000);
  const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });

  const handleDeclare = async () => {
    if (sending) return;
    setSending(true);
    setError(null);
    const failure = await onDeclare(selectedDomain);
    setSending(false);
    if (failure !== null) {
      setError(failure);
      return;
    }
    setDeclared(true);
    closeTimer.current = setTimeout(onClose, 1200);
  };

  return (
    <Sheet visible={visible} title={`Challenge ${shortCodename(rival.codename)}`} onClose={onClose} dismissable={!sending}>
      {declared ? (
        <SystemWindow title="CHALLENGE DECLARED">
          <Text style={[type.title, { color: colors.foreground }]}>
            {selectedDomain}, {fmt(startDate)} to {fmt(endDate)}. The System is watching.
          </Text>
        </SystemWindow>
      ) : (
        <>
          <View style={s.head}>
            <RankMark rank={rival.rank} />
            <Text style={[type.meta, s.flex, { color: colors.mutedForeground }]}>{TRAJECTORY_WORDS[rival.trajectory]}</Text>
          </View>

          <View style={s.chips} accessibilityRole="radiogroup" accessibilityLabel="Domain">
            {DOMAINS.map((d) => (
              <Chip key={d} label={d} dot={DOMAIN_COLORS[d]} selected={d === selectedDomain} onPress={() => setSelectedDomain(d)} />
            ))}
          </View>

          <View style={[s.matchup, { borderColor: colors.border }]}>
            <View style={s.side}>
              <Text style={[type.label, { color: colors.mutedForeground }]}>YOU</Text>
              <Text style={[type.number, { color: colors.foreground }]}>{userScore.toFixed(1)}</Text>
            </View>
            <View style={s.side}>
              <Text style={[type.label, { color: colors.mutedForeground }]}>RIVAL</Text>
              <Text style={[type.number, { color: colors.foreground }]}>{rivalScore.toFixed(1)}</Text>
            </View>
          </View>
          <Text style={[type.bodyStrong, { color: tone(gap.tone) }]}>
            {selectedDomain}: {gapLine(gap)}
          </Text>
          <Text style={[type.meta, { color: colors.mutedForeground }]}>
            {fmt(startDate)} to {fmt(endDate)}. Gain more {selectedDomain} points than the rival over {RIVAL_CHALLENGE_DAYS} days.
          </Text>

          <Button label={sending ? "Transmitting" : "Declare challenge"} block loading={sending} onPress={() => void handleDeclare()} />
          {error ? <Notice message={error} /> : null}
          <Button label="Cancel" variant="text" block disabled={sending} onPress={onClose} />
        </>
      )}
    </Sheet>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1 },
  head: { flexDirection: "row", alignItems: "center", gap: space.md },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  matchup: { flexDirection: "row", borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: space.md },
  side: { flex: 1, alignItems: "center", gap: space.xs },
});
