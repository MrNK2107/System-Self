// Challenges panel: named challenges as three lists (incoming, open, history) under one "New challenge" action.
// Only the two gains in the challenged domain are shown: no other score, never a hidden score.
import { router } from "expo-router";
import React, { useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import type { Challenge } from "@workspace/contracts";

import { ChallengeComposer } from "@/components/ChallengeComposer";
import { Group, Notice, RankMark, Section, Sheet, useToneColor } from "@/components/arena/parts";
import { ProLock } from "@/components/ProLock";
import { Button } from "@/components/ui/Button";
import { ListRow } from "@/components/ui/ListRow";
import { DOMAIN_COLORS } from "@/constants/domains";
import { space, type } from "@/constants/type";
import { useColors } from "@/hooks/useColors";
import { useChallengeActions, useChallengesQuery } from "@/hooks/useChallenges";
import { useMyClanQuery } from "@/hooks/useClan";
import { useFollowingQuery } from "@/hooks/useSocial";
import { isProRequired } from "@/lib/api/pro";
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
import type { MutationResult } from "@/lib/game/actions";
import { gapFromUser } from "@/lib/social/arena";

const SYNC_PENDING = "Queued entries have not reached the System yet. Retry shortly.";

/** Pick who to challenge (followed players and clanmates), then compose. */
function NewChallengeSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const colors = useColors();
  const following = useFollowingQuery();
  const clan = useMyClanQuery();
  const [opponent, setOpponent] = useState<string | null>(null);
  const followed = following.data ?? [];
  const clanmates = clan.data?.clan ? clan.data.members.filter((m) => !m.isSelf) : [];
  const close = () => {
    setOpponent(null);
    onClose();
  };

  return (
    <Sheet visible={visible} title={opponent ? `Challenge ${opponent}` : "New challenge"} onClose={close}>
      {opponent ? (
        <>
          <ChallengeComposer opponent={opponent} />
          <Button label="Pick someone else" variant="text" block onPress={() => setOpponent(null)} />
        </>
      ) : following.isPending && clan.isPending ? (
        <ActivityIndicator color={colors.primary} />
      ) : followed.length === 0 && clanmates.length === 0 ? (
        <>
          <Text style={[type.body, { color: colors.mutedForeground }]}>No one to challenge yet. Follow a player or join a clan.</Text>
          <Button
            label="Find players"
            block
            onPress={() => {
              close();
              router.push("/social/search");
            }}
          />
        </>
      ) : (
        <>
          {followed.length > 0 ? (
            <Section label="Following">
              <Group>
                {followed.map((p) => (
                  <ListRow key={p.handle} title={p.handle} trailing={<RankMark rank={p.rank} />} accessibilityLabel={`${p.handle}, rank ${p.rank}`} chevron onPress={() => setOpponent(p.handle)} />
                ))}
              </Group>
            </Section>
          ) : null}
          {clanmates.length > 0 ? (
            <Section label="Clanmates">
              <Group>
                {clanmates.map((m) => (
                  <ListRow key={m.userId} title={m.profile.handle} trailing={<RankMark rank={m.profile.rank} />} accessibilityLabel={`${m.profile.handle}, rank ${m.profile.rank}`} chevron onPress={() => setOpponent(m.profile.handle)} />
                ))}
              </Group>
            </Section>
          ) : null}
        </>
      )}
    </Sheet>
  );
}

export function ChallengesPanel() {
  const colors = useColors();
  const tone = useToneColor();
  const q = useChallengesQuery();
  const actions = useChallengeActions();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pro, setPro] = useState(false);
  const [composing, setComposing] = useState(false);
  const [rules, setRules] = useState(false);
  const [answering, setAnswering] = useState<Challenge | null>(null);

  const attempt = async (send: () => Promise<MutationResult<unknown>>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await send();
      if (!r.ok) setError(SYNC_PENDING);
      else setAnswering(null);
    } catch (e) {
      if (isProRequired(e)) setPro(true);
      else setError(describeChallengeError(e));
    } finally {
      setBusy(false);
    }
  };

  const now = new Date();
  const groups = groupChallenges(q.data ?? []);
  const open = [...groups.active, ...groups.sent];

  const activeRow = (c: Challenge) => {
    const line = standingLine(c);
    const gap = c.myGain !== null && c.theirGain !== null ? gapFromUser(c.myGain, c.theirGain) : null;
    return (
      <ListRow
        key={c.id}
        title={challengeHeadline(c)}
        dot={DOMAIN_COLORS[c.domain]}
        subtitle={c.myGain === null || c.theirGain === null ? statusLine(c) : `You ${gainLabel(c.myGain)} · them ${gainLabel(c.theirGain)} · ${statusLine(c)}`}
        trailing={gap && line ? <Text style={[type.label, { color: tone(gap.tone) }]}>{gap.tone === "lead" ? "LEADING" : gap.tone === "trail" ? "TRAILING" : "TIED"}</Text> : undefined}
      />
    );
  };

  return (
    <>
      <Button label="New challenge" block onPress={() => setComposing(true)} />
      {pro ? <ProLock label="NAMED CHALLENGE" /> : null}
      {error && !answering ? <Notice message={error} /> : null}

      {q.isError && !q.data ? (
        <Notice message={describeChallengeError(q.error)} onRetry={() => void q.refetch()} />
      ) : !q.data ? (
        <ActivityIndicator color={colors.primary} style={s.loading} />
      ) : (
        <>
          <Section label={`Incoming · ${groups.incoming.length}`}>
            {groups.incoming.length === 0 ? (
              <Text style={[type.body, { color: colors.mutedForeground }]}>No one has called you out.</Text>
            ) : (
              <Group>
                {groups.incoming.map((c) => (
                  <ListRow
                    key={c.id}
                    title={challengeHeadline(c)}
                    dot={DOMAIN_COLORS[c.domain]}
                    subtitle={`Answer: ${respondTimeLeft(c.respondBy, now)}`}
                    chevron
                    onPress={() => {
                      setError(null);
                      setAnswering(c);
                    }}
                  />
                ))}
              </Group>
            )}
          </Section>

          <Section label={`Open · ${open.length}`}>
            {open.length === 0 ? (
              <Text style={[type.body, { color: colors.mutedForeground }]}>Nothing running. Call someone out.</Text>
            ) : (
              <Group>
                {groups.active.map(activeRow)}
                {groups.sent.map((c) => (
                  <ListRow key={c.id} title={challengeHeadline(c)} dot={DOMAIN_COLORS[c.domain]} subtitle={statusLine(c)} />
                ))}
              </Group>
            )}
          </Section>

          {groups.closed.length > 0 ? (
            <Section label="History">
              <Group>
                {groups.closed.map((c) => (
                  <ListRow
                    key={c.id}
                    title={challengeHeadline(c)}
                    dot={c.outcome === "win" ? colors.success : c.outcome === "loss" ? colors.destructive : colors.subtle}
                    subtitle={
                      c.status === "resolved" && c.myGain !== null && c.theirGain !== null
                        ? `You ${gainLabel(c.myGain)} · them ${gainLabel(c.theirGain)} · ${statusLine(c)}`
                        : statusLine(c)
                    }
                  />
                ))}
              </Group>
            </Section>
          ) : null}
        </>
      )}

      <Group>
        <ListRow title="How challenges work" chevron onPress={() => setRules(true)} />
      </Group>

      {composing ? <NewChallengeSheet visible onClose={() => setComposing(false)} /> : null}

      <Sheet visible={rules} title="How challenges work" onClose={() => setRules(false)}>
        <Text style={[type.body, { color: colors.foreground }]}>{CHALLENGE_RULE}</Text>
        <Text style={[type.body, { color: colors.mutedForeground }]}>
          Challenge a player you follow or a clanmate. They have 48 hours to answer. Only the two gains in the chosen domain are shown.
        </Text>
      </Sheet>

      <Sheet visible={answering !== null} title="Incoming challenge" onClose={() => setAnswering(null)} dismissable={!busy}>
        {answering ? (
          <>
            <Text style={[type.title, { color: colors.foreground }]}>{challengeHeadline(answering)}</Text>
            <Text style={[type.body, { color: colors.mutedForeground }]}>
              {statusLine(answering)} {respondTimeLeft(answering.respondBy, now)}.
            </Text>
            <Text style={[type.meta, { color: colors.mutedForeground }]}>{CHALLENGE_RULE}</Text>
            {pro ? <ProLock label="NAMED CHALLENGE" /> : null}
            {error ? <Notice message={error} /> : null}
            <View style={s.answer}>
              <Button label="Accept" block loading={busy} onPress={() => void attempt(() => actions.accept(answering.id))} />
              <Button label="Ignore" variant="text" block disabled={busy} onPress={() => void attempt(() => actions.ignore(answering.id))} />
            </View>
          </>
        ) : null}
      </Sheet>
    </>
  );
}

const s = StyleSheet.create({
  loading: { marginTop: space.xl },
  answer: { gap: space.sm },
});
