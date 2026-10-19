// Clan peer ratings (SOCIAL): rate up to 5 clanmates a week, 1-5. Ratings are anonymous; at week close a clanmate
// with 4 or more ratings has their SOCIAL score moved by (average - 3). Only what the viewer gave is ever shown.
import React, { useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import type { ClanMember } from "@workspace/contracts";
import { AuthNotice, AuthShell } from "@/components/AuthShell";
import { RankBadge } from "@/components/RankBadge";
import { useColors } from "@/hooks/useColors";
import { useClanActions, useMyClanQuery, usePeerRatingsQuery } from "@/hooks/useClan";
import { SYNC_PENDING_MESSAGE } from "@/lib/clan/clan";
import { RATING_ANONYMITY_LINE, RATING_VALUES, canRate, describeRatingError, rateableMembers, ratedValue, remainingLine } from "@/lib/clan/ratings";
import type { PeerRatingsMine } from "@workspace/contracts";

function MemberRow({
  m,
  view,
  busy,
  onRate,
}: {
  m: ClanMember;
  view: PeerRatingsMine | undefined;
  busy: boolean;
  onRate: (rating: number) => void;
}) {
  const colors = useColors();
  const handle = m.profile.handle;
  const current = ratedValue(view, handle);
  const enabled = canRate(view, handle) && !busy;
  return (
    <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={s.head}>
        <RankBadge rank={m.profile.rank} size="sm" />
        <Text style={[s.handle, { color: colors.foreground }]} numberOfLines={1}>
          {handle}
        </Text>
      </View>
      <View style={s.scale}>
        {RATING_VALUES.map((v) => {
          const selected = current === v;
          return (
            <TouchableOpacity
              key={v}
              onPress={() => onRate(v)}
              disabled={!enabled}
              accessibilityRole="button"
              accessibilityLabel={`Rate ${handle} ${v} of 5`}
              accessibilityState={{ selected, disabled: !enabled }}
              style={[
                s.cell,
                {
                  borderColor: selected ? colors.primary : colors.border,
                  backgroundColor: selected ? colors.accentFill + "22" : "transparent",
                  opacity: enabled || selected ? 1 : 0.4,
                },
              ]}
            >
              <Text style={[s.cellText, { color: selected ? colors.primary : colors.foreground }]}>{v}</Text>
            </TouchableOpacity>
          );
        })}
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
    <AuthShell tag="CLAN" title="Peer ratings" subtitle={RATING_ANONYMITY_LINE} back>
      {error ? <AuthNotice message={error} /> : null}
      {!data ? (
        <AuthNotice
          tone={clanQ.isError ? "error" : "info"}
          message={clanQ.isError ? describeRatingError(clanQ.error) : "Loading."}
          onRetry={clanQ.isError ? () => void clanQ.refetch() : undefined}
        />
      ) : !data.clan ? (
        <AuthNotice tone="info" message="You are not in a clan." />
      ) : (
        <>
          {view ? (
            <Text style={[s.remaining, { color: colors.primary }]}>{remainingLine(view.remaining)}</Text>
          ) : ratingsQ.isError ? (
            <AuthNotice message={describeRatingError(ratingsQ.error)} onRetry={() => void ratingsQ.refetch()} />
          ) : null}
          <Text style={[s.rule, { color: colors.mutedForeground }]}>
            A clanmate with 4 or more ratings at week close moves by their average minus 3. Open to operators who have been in the clan for 7 days.
          </Text>
          {members.length === 0 ? (
            <AuthNotice tone="info" message="No clanmates to rate yet." />
          ) : (
            <View style={s.list}>
              {members.map((m) => (
                <MemberRow key={m.userId} m={m} view={view} busy={busy} onRate={(v) => void rate(m.userId, v)} />
              ))}
            </View>
          )}
        </>
      )}
    </AuthShell>
  );
}

const s = StyleSheet.create({
  list: { gap: 8 },
  card: { borderWidth: 1, borderRadius: 4, padding: 12, gap: 10 },
  head: { flexDirection: "row", alignItems: "center", gap: 12 },
  handle: { flex: 1, fontSize: 14, fontWeight: "700" as const, letterSpacing: 0.5 },
  scale: { flexDirection: "row", gap: 8 },
  cell: { flex: 1, minHeight: 44, borderWidth: 1, borderRadius: 3, alignItems: "center", justifyContent: "center" },
  cellText: { fontSize: 15, fontWeight: "800" as const, fontFamily: "SpaceMono" },
  remaining: { fontSize: 11, fontWeight: "800" as const, letterSpacing: 1.5 },
  rule: { fontSize: 12, lineHeight: 18 },
});
