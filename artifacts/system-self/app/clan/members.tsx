// The clan roster as clanmates see it: username, rank, five domain scores, shadow status, 30-day quest completion
// (% only) and the inactivity flag. A member opens in a sheet: their scores, a challenge, and (for the leader)
// remove a flagged member or hand over leadership.
import React, { useState } from "react";
import { ActivityIndicator, Alert, Platform, Text } from "react-native";
import { RANKED_DOMAINS } from "@workspace/engine";
import type { ClanMember } from "@workspace/contracts";
import { ChallengeComposer } from "@/components/ChallengeComposer";
import { Group, Notice, Sheet } from "@/components/arena/parts";
import { Button } from "@/components/ui/Button";
import { ListRow } from "@/components/ui/ListRow";
import { Screen } from "@/components/ui/Screen";
import { DOMAIN_COLORS } from "@/constants/domains";
import { type } from "@/constants/type";
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

const memberLine = (m: ClanMember) =>
  [`Rank ${m.profile.rank}`, `Quests 30d ${completionLabel(m.questCompletionRate30d)}`, m.flagged ? "Inactive 5 days" : null, m.profile.shadowActive ? "Shadow active" : null]
    .filter(Boolean)
    .join(" · ");

export default function ClanMembersScreen() {
  const colors = useColors();
  const q = useMyClanQuery();
  const actions = useClanActions();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [challenging, setChallenging] = useState(false);

  const attempt = async (send: () => Promise<MutationResult<unknown>>) => {
    setBusy(true);
    setError(null);
    try {
      const r = await send();
      if (!r.ok) setError(SYNC_PENDING_MESSAGE);
      else setOpenId(null);
    } catch (e) {
      setError(describeClanError(e));
    } finally {
      setBusy(false);
    }
  };

  const data = q.data;
  const leaderView = isLeader(data);
  // Leader actions come from the plain helpers: remove flagged members only, transfer to anyone but self.
  const removable = new Set(leaderView && data ? removableMembers(data.members).map((m) => m.userId) : []);
  const heirs = new Set(leaderView && data ? transferCandidates(data.members).map((m) => m.userId) : []);
  const open = data?.members.find((m) => m.userId === openId) ?? null;
  const show = (m: ClanMember) => {
    setError(null);
    setChallenging(false);
    setOpenId(m.userId);
  };

  return (
    <Screen title="Roster" back>
      <Text style={[type.body, { color: colors.mutedForeground }]}>
        Members see each other by username. A member quiet for 5 days in a row is flagged and stops counting toward the clan score.
      </Text>
      {error && !open ? <Notice message={error} /> : null}
      {!data ? (
        q.isError ? (
          <Notice message={describeClanError(q.error)} onRetry={() => void q.refetch()} />
        ) : (
          <ActivityIndicator color={colors.primary} />
        )
      ) : !data.clan ? (
        <Notice tone="info" message="You are not in a clan." />
      ) : (
        <Group>
          {data.members.map((m) => (
            <ListRow
              key={m.userId}
              title={`${m.profile.handle}${m.role === "leader" ? " · Leader" : ""}${m.isSelf ? " · You" : ""}`}
              subtitle={memberLine(m)}
              dot={m.flagged ? colors.warn : undefined}
              chevron
              onPress={() => show(m)}
            />
          ))}
        </Group>
      )}

      <Sheet visible={open !== null} title={open?.profile.handle ?? "Member"} onClose={() => setOpenId(null)} dismissable={!busy}>
        {open ? (
          <>
            <Text style={[type.meta, { color: colors.mutedForeground }]}>{memberLine(open)}</Text>
            {open.profile.scores ? (
              <Group>
                {RANKED_DOMAINS.map((d) => (
                  <ListRow
                    key={d}
                    title={d}
                    dot={DOMAIN_COLORS[d]}
                    trailing={<Text style={[type.number, { color: colors.foreground }]}>{open.profile.scores![d].toFixed(1)}</Text>}
                  />
                ))}
              </Group>
            ) : null}
            {!open.isSelf ? (
              challenging ? (
                <ChallengeComposer opponent={open.profile.handle} />
              ) : (
                <Button label="Challenge" block onPress={() => setChallenging(true)} />
              )
            ) : null}
            {error ? <Notice message={error} /> : null}
            {heirs.has(open.userId) ? (
              <Button
                label="Make leader"
                variant="tonal"
                block
                disabled={busy}
                onPress={() =>
                  confirm("Transfer leadership?", `${open.profile.handle} becomes the leader. You become a member.`, "Transfer", () =>
                    void attempt(() => actions.transfer(open.userId)),
                  )
                }
              />
            ) : null}
            {removable.has(open.userId) ? (
              <Button
                label="Remove from clan"
                variant="destructive"
                block
                loading={busy}
                onPress={() => confirm("Remove this member?", `${open.profile.handle} leaves the clan.`, "Remove", () => void attempt(() => actions.remove(open.userId)))}
              />
            ) : null}
          </>
        ) : null}
      </Sheet>
    </Screen>
  );
}


