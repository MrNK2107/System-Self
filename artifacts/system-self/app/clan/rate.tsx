// Clan peer ratings (SOCIAL): rate up to 5 clanmates a week, 1-5. Ratings are anonymous; at week close a clanmate
// with 4 or more ratings has their SOCIAL score moved by (average - 3). Only what the viewer gave is ever shown.
import React, { useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import type { ClanMember, PeerRatingsMine } from "@workspace/contracts";
import { Chip, Group, Notice } from "@/components/arena/parts";
import { Screen } from "@/components/ui/Screen";
import { space, type } from "@/constants/type";
import { useColors } from "@/hooks/useColors";
import { useClanActions, useMyClanQuery, usePeerRatingsQuery } from "@/hooks/useClan";
import { SYNC_PENDING_MESSAGE } from "@/lib/clan/clan";
import { RATING_ANONYMITY_LINE, RATING_VALUES, canRate, describeRatingError, rateableMembers, ratedValue, remainingLine } from "@/lib/clan/ratings";

function MemberRow({ m, view, busy, onRate }: { m: ClanMember; view: PeerRatingsMine | undefined; busy: boolean; onRate: (rating: number) => void }) {
  const colors = useColors();
  const handle = m.profile.handle;
  const current = ratedValue(view, handle);
  const enabled = canRate(view, handle) && !busy;
  return (
    <View style={[s.member, { borderBottomColor: colors.border }]}>
      <Text style={[type.body, { color: colors.foreground }]} numberOfLines={1}>
        {handle} <Text style={[type.meta, { color: colors.mutedForeground }]}>Rank {m.profile.rank}</Text>
      </Text>
      <View style={s.scale}>
        {RATING_VALUES.map((v) => (
          <View key={v} style={s.cell}>
            <Chip label={String(v)} selected={current === v} disabled={!enabled} onPress={() => onRate(v)} accessibilityLabel={`Rate ${handle} ${v} of 5`} />
          </View>
        ))}
      </View>
    </View>
  );
}

export default function ClanRateScreen() {
  const colors = useColors();
  const clanQ = useMyClanQuery();
  const hasClan = !!clanQ.data?.clan;
  const ratingsQ = usePeerRatingsQuery(hasClan);
  const actions = useClanActions();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rate = async (userId: string, rating: number) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await actions.rate(userId, rating);
      if (!r.ok) setError(SYNC_PENDING_MESSAGE);
    } catch (e) {
      setError(describeRatingError(e));
    } finally {
      setBusy(false);
    }
  };

  const data = clanQ.data;
  const view = ratingsQ.data;
  const members = data?.clan ? rateableMembers(data.members) : [];

  return (
    <Screen title="Peer ratings" back>
      <Text style={[type.body, { color: colors.mutedForeground }]}>{RATING_ANONYMITY_LINE}</Text>
      {error ? <Notice message={error} /> : null}
      {!data ? (
        clanQ.isError ? (
          <Notice message={describeRatingError(clanQ.error)} onRetry={() => void clanQ.refetch()} />
        ) : (
          <ActivityIndicator color={colors.primary} />
        )
      ) : !data.clan ? (
        <Notice tone="info" message="You are not in a clan." />
      ) : (
        <>
          {view ? (
            <Text style={[type.bodyStrong, { color: colors.primary }]}>{remainingLine(view.remaining)}</Text>
          ) : ratingsQ.isError ? (
            <Notice message={describeRatingError(ratingsQ.error)} onRetry={() => void ratingsQ.refetch()} />
          ) : null}
          <Text style={[type.meta, { color: colors.mutedForeground }]}>
            A clanmate with 4 or more ratings at week close moves by their average minus 3. Open to operators who have been in the clan for 7 days.
          </Text>
          {members.length === 0 ? (
            <Notice tone="info" message="No clanmates to rate yet." />
          ) : (
            <Group>
              {members.map((m) => (
                <MemberRow key={m.userId} m={m} view={view} busy={busy} onRate={(v) => void rate(m.userId, v)} />
              ))}
            </Group>
          )}
        </>
      )}
    </Screen>
  );
}

const s = StyleSheet.create({
  member: { padding: 16, gap: space.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  scale: { flexDirection: "row", gap: space.sm },
  cell: { flex: 1 },
});
