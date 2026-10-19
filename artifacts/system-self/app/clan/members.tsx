// The clan roster as clanmates see it: username, rank, five domain scores, shadow status, 30-day quest completion
// (% only) and the dead-weight flag. The leader can remove flagged members and transfer leadership.
import React, { useState } from "react";
import { Alert, Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { RANKED_DOMAINS } from "@workspace/engine";
import type { ClanMember } from "@workspace/contracts";
import { AuthNotice, AuthShell } from "@/components/AuthShell";
import { ChallengeComposer } from "@/components/ChallengeComposer";
import { RankBadge } from "@/components/RankBadge";
import { useColors } from "@/hooks/useColors";
import { useClanActions, useMyClanQuery } from "@/hooks/useClan";
import { SYNC_PENDING_MESSAGE, completionLabel, describeClanError, isLeader, removableMembers, transferCandidates } from "@/lib/clan/clan";
import type { MutationResult } from "@/lib/game/actions";

function confirm(title: string, body: string, action: string, run: () => void) {
  if (Platform.OS === "web") return run();
  Alert.alert(title, body, [
    { text: "Cancel", style: "cancel" },
    { text: action, style: "destructive", onPress: run },
  ]);
}

function MemberCard({
  m,
  canRemove,
  canTransfer,
  busy,
  onRemove,
  onTransfer,
}: {
  m: ClanMember;
  canRemove: boolean;
  canTransfer: boolean;
  busy: boolean;
  onRemove: () => void;
  onTransfer: () => void;
}) {
  const colors = useColors();
  const p = m.profile;
  const [challenging, setChallenging] = useState(false);
  return (
    <View style={[s.card, { backgroundColor: colors.card, borderColor: m.flagged ? "#E0555560" : colors.border }]}>
      <View style={s.head}>
        <RankBadge rank={p.rank} size="sm" />
        <View style={s.body}>
          <Text style={[s.handle, { color: m.isSelf ? colors.primary : colors.foreground }]} numberOfLines={1}>
            {p.handle}
            {m.role === "leader" ? "  · LEADER" : ""}
            {m.isSelf ? "  · YOU" : ""}
          </Text>
          <Text style={[s.meta, { color: colors.mutedForeground }]}>
            QUESTS 30D {completionLabel(m.questCompletionRate30d)}
            {p.shadowActive ? "  ·  SHADOW ACTIVE" : ""}
            {m.flagged ? "  ·  DEAD WEIGHT" : ""}
          </Text>
        </View>
      </View>
      {p.scores ? (
        <View style={s.scores}>
          {RANKED_DOMAINS.map((d) => (
            <View key={d} style={s.score}>
              <Text style={[s.scoreVal, { color: colors.foreground }]}>{Math.round(p.scores![d])}</Text>
              <Text style={[s.scoreLabel, { color: colors.mutedForeground }]}>{d.slice(0, 4)}</Text>
            </View>
          ))}
        </View>
      ) : null}
      {!m.isSelf ? (
        challenging ? (
          <ChallengeComposer opponent={p.handle} />
        ) : (
          <TouchableOpacity onPress={() => setChallenging(true)} accessibilityRole="button" style={[s.action, { borderColor: colors.primary, alignSelf: "flex-start" }]}>
            <Text style={[s.actionText, { color: colors.primary }]}>CHALLENGE</Text>
          </TouchableOpacity>
        )
      ) : null}
      {canRemove || canTransfer ? (
        <View style={s.actions}>
          {canRemove ? (
            <TouchableOpacity onPress={onRemove} disabled={busy} accessibilityRole="button" style={[s.action, { borderColor: colors.destructive }]}>
              <Text style={[s.actionText, { color: colors.foreground }]}>REMOVE</Text>
            </TouchableOpacity>
          ) : null}
          {canTransfer ? (
            <TouchableOpacity onPress={onTransfer} disabled={busy} accessibilityRole="button" style={[s.action, { borderColor: colors.border }]}>
              <Text style={[s.actionText, { color: colors.mutedForeground }]}>MAKE LEADER</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

export default function ClanMembersScreen() {
  const q = useMyClanQuery();
  const actions = useClanActions();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const attempt = async (send: () => Promise<MutationResult<unknown>>) => {
    setBusy(true);
    setError(null);
    try {
      const r = await send();
      if (!r.ok) setError(SYNC_PENDING_MESSAGE);
    } catch (e) {
      setError(describeClanError(e));
    } finally {
      setBusy(false);
    }
  };

  const data = q.data;
  const leaderView = isLeader(data);
  // Leader actions come from the plain helpers: remove flagged dead weight only, transfer to anyone but self.
  const removable = new Set(leaderView && data ? removableMembers(data.members).map((m) => m.userId) : []);
  const heirs = new Set(leaderView && data ? transferCandidates(data.members).map((m) => m.userId) : []);

  return (
    <AuthShell tag="CLAN" title="Roster" subtitle="Members see each other by username. Flagged: 5 consecutive inactive days, excluded from the clan score." back>
      {error ? <AuthNotice message={error} /> : null}
      {!data ? (
        <AuthNotice tone={q.isError ? "error" : "info"} message={q.isError ? describeClanError(q.error) : "Loading."} onRetry={q.isError ? () => void q.refetch() : undefined} />
      ) : !data.clan ? (
        <AuthNotice tone="info" message="You are not in a clan." />
      ) : (
        <View style={s.list}>
          {data.members.map((m) => (
            <MemberCard
              key={m.userId}
              m={m}
              canRemove={removable.has(m.userId)}
              canTransfer={heirs.has(m.userId)}
              busy={busy}
              onRemove={() => confirm("Remove dead weight?", `${m.profile.handle} leaves the clan.`, "Remove", () => void attempt(() => actions.remove(m.userId)))}
              onTransfer={() =>
                confirm("Transfer leadership?", `${m.profile.handle} becomes the leader. You become a member.`, "Transfer", () => void attempt(() => actions.transfer(m.userId)))
              }
            />
          ))}
        </View>
      )}
    </AuthShell>
  );
}

const s = StyleSheet.create({
  list: { gap: 8 },
  card: { borderWidth: 1, borderRadius: 4, padding: 12, gap: 10 },
  head: { flexDirection: "row", alignItems: "center", gap: 12 },
  body: { flex: 1, gap: 3 },
  handle: { fontSize: 14, fontWeight: "700" as const, letterSpacing: 0.5 },
  meta: { fontSize: 9, letterSpacing: 1.5, fontWeight: "700" as const },
  scores: { flexDirection: "row", justifyContent: "space-between" },
  score: { alignItems: "center", gap: 2, flex: 1 },
  scoreVal: { fontSize: 13, fontWeight: "800" as const, fontFamily: "SpaceMono" },
  scoreLabel: { fontSize: 8, fontWeight: "800" as const, letterSpacing: 1.5 },
  actions: { flexDirection: "row", gap: 8 },
  action: { borderWidth: 1, borderRadius: 3, paddingHorizontal: 12, paddingVertical: 6 },
  actionText: { fontSize: 10, fontWeight: "800" as const, letterSpacing: 2 },
});
