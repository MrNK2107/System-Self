// Party of Two: your one partner, the last 7 days of check-ins, the invites waiting on you or on them, and leaving.
// Inside a duo both of you see usernames; nothing here scores. Invites start from a player's profile.
import React, { useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { Group, Notice, Section } from "@/components/arena/parts";
import { DuoCheckinButtons } from "@/components/DuoCard";
import { Button } from "@/components/ui/Button";
import { ListRow } from "@/components/ui/ListRow";
import { Screen } from "@/components/ui/Screen";
import { space, type } from "@/constants/type";
import { useColors } from "@/hooks/useColors";
import { useDuoActions, useDuoQuery } from "@/hooks/useDuo";
import { agoLabel, checkinLine, describeDuoError, duoKindLabel } from "@/lib/duo/duo";
import type { MutationResult } from "@/lib/game/actions";

const SYNC_PENDING = "Queued entries have not reached the System yet. Retry shortly.";
const TRAJECTORY_WORDS: Record<string, string> = { up: "Rising", stable: "Steady", down: "Falling" };

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
  const partner = view?.partner ?? null;

  return (
    <Screen title="Party of two" back>
      <Text style={[type.body, { color: colors.mutedForeground }]}>One partner. You see each other's check-ins. No score effect.</Text>
      {error ? <Notice message={error} /> : null}
      {q.isError && !view ? (
        <Notice message={describeDuoError(q.error)} onRetry={() => void q.refetch()} />
      ) : !view ? (
        <ActivityIndicator color={colors.primary} />
      ) : partner ? (
        <>
          <Group>
            <ListRow
              title={partner.handle}
              subtitle={[`Rank ${partner.rank}`, TRAJECTORY_WORDS[partner.trajectory] ?? partner.trajectory, partner.shadowActive ? "Shadow active" : null]
                .filter(Boolean)
                .join(" · ")}
              dot={(colors.rank as Record<string, string>)[partner.rank]}
            />
          </Group>
          <DuoCheckinButtons />
          <Section label="Last 7 days">
            {view.checkins.length === 0 ? (
              <Text style={[type.body, { color: colors.mutedForeground }]}>No check-ins yet. Walk in together.</Text>
            ) : (
              <Group>
                {view.checkins.map((c) => (
                  <ListRow
                    key={c.id}
                    title={duoKindLabel(c.kind)}
                    subtitle={`${c.fromMe ? "You" : partner.handle} · ${agoLabel(c.createdAt, now)}`}
                    dot={c.fromMe ? undefined : colors.primary}
                    accessibilityLabel={checkinLine(c, partner.handle, now)}
                  />
                ))}
              </Group>
            )}
          </Section>
          {confirmLeave ? (
            <View style={s.stack}>
              <Text style={[type.body, { color: colors.mutedForeground }]}>Leaving ends the duo for both of you and clears its check-ins.</Text>
              <Button label="Confirm leave" variant="destructive" block loading={busy} onPress={() => void attempt(() => actions.leave())} />
              <Button label="Cancel" variant="text" block onPress={() => setConfirmLeave(false)} />
            </View>
          ) : (
            <Button label="Leave party of two" variant="text" onPress={() => setConfirmLeave(true)} />
          )}
        </>
      ) : (
        <>
          {incoming.length > 0 ? (
            <Section label="Invites">
              {incoming.map((i) => (
                <View key={i.id} style={s.stack}>
                  <Text style={[type.bodyStrong, { color: colors.foreground }]}>{i.handle} invited you.</Text>
                  <Button label="Accept" block loading={busy} onPress={() => void attempt(() => actions.answer(i.id, "accept"))} />
                  <Button label="Decline" variant="text" block disabled={busy} onPress={() => void attempt(() => actions.answer(i.id, "decline"))} />
                </View>
              ))}
            </Section>
          ) : null}
          {outgoing.length > 0 ? (
            <Section label="Sent">
              <Group>
                {outgoing.map((i) => (
                  <ListRow key={i.id} title={i.handle} subtitle="Waiting for an answer" />
                ))}
              </Group>
            </Section>
          ) : null}
          {incoming.length === 0 && outgoing.length === 0 ? (
            <>
              <Text style={[type.body, { color: colors.mutedForeground }]}>No partner. Open a player's profile to invite them.</Text>
              <Button label="Find players" block onPress={() => router.push("/social/search")} />
            </>
          ) : null}
        </>
      )}
    </Screen>
  );
}

const s = StyleSheet.create({
  stack: { gap: space.sm },
});
