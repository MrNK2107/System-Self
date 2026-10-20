// Clan panel: the user's clan (GET /api/clans/mine, polled every minute while focused): who is in it and how this
// week's raid stands. Without a clan: one System line and the two ways in. The global board, dispatches and the
// rules sit behind rows. Members are shown by username (inside a clan there is no anonymity, PRD 16); the hidden
// score never reaches the app, only the clan score.
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useState } from "react";
import { ActivityIndicator, Alert, Platform, Share, StyleSheet, Text, View } from "react-native";
import type { ClanLeaderboardItem, MyClanResponse, RaidSummary } from "@workspace/contracts";

import { Group, Notice, RankMark, Section, Sheet } from "@/components/arena/parts";
import { Button } from "@/components/ui/Button";
import { ListRow } from "@/components/ui/ListRow";
import { SystemWindow } from "@/components/ui/SystemWindow";
import { space, type } from "@/constants/type";
import { useColors } from "@/hooks/useColors";
import { useClanActions, useClanLeaderboardQuery, useMyClanQuery, useRaidQuery } from "@/hooks/useClan";
import { CLAN_MAX_MEMBERS, CLAN_MIN_ACTIVE, SYNC_PENDING_MESSAGE, clanLabel, clanStatusLine, completionLabel, describeClanError, leaveBlocker, leaveDisbands, scoreLabel } from "@/lib/clan/clan";
import { RAID_TYPE_RULE, raidMetricLabel, raidPositionLine, raidTimeLeft, raidTitle, raidValueLabel } from "@/lib/clan/raid";

type SheetKind = "rules" | "board" | "raid" | "dispatches" | null;

function Board({ items, mine }: { items: ClanLeaderboardItem[]; mine?: string }) {
  const colors = useColors();
  if (items.length === 0) {
    return <Text style={[type.body, { color: colors.mutedForeground }]}>No ranked clans yet. A clan ranks once it holds 8 operators, 3 of them active.</Text>;
  }
  return (
    <Group>
      {items.map((c) => (
        <ListRow
          key={c.id}
          title={`#${c.clanRank}  ${clanLabel(c)}`}
          subtitle={c.id === mine ? "Your clan" : undefined}
          dot={c.id === mine ? colors.foreground : undefined}
          trailing={<Text style={[type.number, { color: colors.foreground }]}>{scoreLabel(c.clanScore)}</Text>}
        />
      ))}
    </Group>
  );
}

function RaidStandings({ raid }: { raid: RaidSummary }) {
  const colors = useColors();
  return (
    <>
      <Text style={[type.body, { color: colors.foreground }]}>{RAID_TYPE_RULE[raid.type]}</Text>
      <Group>
        {raid.standings.map((c) => (
          <ListRow
            key={c.clanId}
            title={`#${c.position}  ${clanLabel(c)}`}
            subtitle={c.isMine ? "Your clan" : undefined}
            dot={c.isMine ? colors.foreground : undefined}
            trailing={<Text style={[type.number, { color: colors.foreground }]}>{raidValueLabel(raid.type, c.metricValue)}</Text>}
          />
        ))}
      </Group>
      <Text style={[type.meta, { color: colors.mutedForeground }]}>
        {raidMetricLabel(raid.type)}. Your clan: {raidValueLabel(raid.type, raid.myValue)}.
      </Text>
    </>
  );
}

function MyClan({ data, onError, openSheet }: { data: MyClanResponse; onError: (m: string | null) => void; openSheet: (k: SheetKind) => void }) {
  const colors = useColors();
  const actions = useClanActions();
  const raidQ = useRaidQuery(true);
  const raid = raidQ.data;
  const clan = data.clan!;
  const [busy, setBusy] = useState(false);

  const leave = () => {
    const blocker = leaveBlocker(data);
    if (blocker) return onError(blocker);
    const go = async () => {
      setBusy(true);
      onError(null);
      try {
        const r = await actions.leave();
        if (!r.ok) onError(SYNC_PENDING_MESSAGE);
      } catch (e) {
        onError(describeClanError(e));
      } finally {
        setBusy(false);
      }
    };
    const lastOne = leaveDisbands(data);
    if (Platform.OS === "web") return void go();
    Alert.alert(lastOne ? "Disband the clan?" : "Leave the clan?", lastOne ? "You are the last operator. The clan is dissolved." : "Your record stays. Your place does not.", [
      { text: "Cancel", style: "cancel" },
      { text: lastOne ? "Disband" : "Leave", style: "destructive", onPress: () => void go() },
    ]);
  };

  const share = () => void Share.share({ message: `Join ${clanLabel(clan)} on SYSTEM // SELF. Invite code: ${clan.inviteCode}` }).catch(() => {});

  return (
    <>
      <View style={s.head}>
        <Text style={[type.title, { color: colors.foreground }]} accessibilityRole="header">
          {clanLabel(clan)}
        </Text>
        <Text style={[type.meta, { color: clan.status === "active" ? colors.success : colors.warn }]}>{clanStatusLine(clan)}</Text>
        <Text style={[type.meta, { color: colors.mutedForeground }]}>
          Clan score {scoreLabel(clan.clanScore)} · {clan.clanRank ? `Global #${clan.clanRank}` : "Unranked"} · {clan.raidWins} raid win{clan.raidWins === 1 ? "" : "s"}
        </Text>
        {clan.description ? <Text style={[type.body, { color: colors.mutedForeground }]}>{clan.description}</Text> : null}
      </View>

      <Section label="This week's raid">
        {raid ? (
          <Group>
            <ListRow
              title={raidTitle(raid)}
              subtitle={`${raid.resolved ? "Closed" : raidTimeLeft(raid.endsAt, new Date())} · ${raidPositionLine(raid)}`}
              trailing={<Text style={[type.number, { color: colors.foreground }]}>{raidValueLabel(raid.type, raid.myValue)}</Text>}
              chevron
              onPress={() => openSheet("raid")}
            />
          </Group>
        ) : (
          <Notice
            tone={raidQ.isError ? "error" : "info"}
            message={raidQ.isError ? "The raid record is out of reach." : "No raid this week. A raid needs a rival clan of similar rank."}
            onRetry={raidQ.isError ? () => void raidQ.refetch() : undefined}
          />
        )}
      </Section>

      <Section label={`Members · ${clan.memberCount}/${CLAN_MAX_MEMBERS} · ${clan.activeMemberCount} active`}>
        <Group>
          {data.members.map((m) => (
            <ListRow
              key={m.userId}
              title={`${m.profile.handle}${m.role === "leader" ? " · Leader" : ""}${m.isSelf ? " · You" : ""}`}
              subtitle={[`Quests 30d ${completionLabel(m.questCompletionRate30d)}`, m.flagged ? "Inactive 5 days" : null, m.profile.shadowActive ? "Shadow active" : null]
                .filter(Boolean)
                .join(" · ")}
              dot={m.flagged ? colors.warn : undefined}
              trailing={<RankMark rank={m.profile.rank} />}
              accessibilityLabel={`${m.profile.handle}, rank ${m.profile.rank}${m.isSelf ? ", you" : ""}`}
              chevron
              onPress={() => router.push("/clan/members")}
            />
          ))}
        </Group>
      </Section>

      <Section label="Clan">
        <Group>
          <ListRow
            title="Invite code"
            subtitle={clan.inviteCode}
            trailing={<Feather name="share-2" size={20} color={colors.primary} />}
            onPress={share}
            accessibilityLabel={`Share invite code ${clan.inviteCode}`}
          />
          <ListRow title="Peer ratings" subtitle="Rate your clanmates. Anonymous." chevron onPress={() => router.push("/clan/rate")} />
          <ListRow
            title="Dispatches"
            subtitle={data.dispatches.length === 0 ? "None yet." : `${data.dispatches.length} from THE SYSTEM`}
            chevron
            onPress={() => openSheet("dispatches")}
          />
          <ListRow title="Clan rankings" chevron onPress={() => openSheet("board")} />
          <ListRow title="How clans work" chevron onPress={() => openSheet("rules")} />
        </Group>
      </Section>

      <Button label={leaveDisbands(data) ? "Disband clan" : "Leave clan"} variant="text" loading={busy} onPress={leave} />
    </>
  );
}

export function ClanPanel() {
  const colors = useColors();
  const q = useMyClanQuery();
  const board = useClanLeaderboardQuery();
  const raid = useRaidQuery(!!q.data?.clan).data;
  const [message, setMessage] = useState<string | null>(null);
  const [sheet, setSheet] = useState<SheetKind>(null);
  const close = () => setSheet(null);

  if (!q.data) {
    return q.isError ? (
      <Notice message="The clan record is out of reach. Check your connection." onRetry={() => void q.refetch()} />
    ) : (
      <ActivityIndicator color={colors.primary} style={s.loading} />
    );
  }

  const data = q.data;

  return (
    <>
      {message ? <Notice message={message} /> : null}

      {data.clan ? (
        <MyClan data={data} onError={setMessage} openSheet={setSheet} />
      ) : (
        <>
          <SystemWindow title="CLAN">
            <Text style={[type.title, { color: colors.foreground }]}>You fight alone. A clan raids together every week.</Text>
            <View style={s.ctas}>
              <Button label="Create a clan" block onPress={() => router.push("/clan/create")} />
              <Button label="Join with a code" variant="tonal" block onPress={() => router.push("/clan/join")} />
            </View>
          </SystemWindow>
          <Group>
            <ListRow title="How clans work" chevron onPress={() => setSheet("rules")} />
            <ListRow title="Clan rankings" subtitle="The top clans this season" chevron onPress={() => setSheet("board")} />
          </Group>
        </>
      )}

      <Sheet visible={sheet === "rules"} title="How clans work" onClose={close}>
        <Text style={[type.body, { color: colors.foreground }]}>
          A clan holds {CLAN_MIN_ACTIVE} to {CLAN_MAX_MEMBERS} operators who see each other by username and push each other forward.
        </Text>
        <Text style={[type.body, { color: colors.mutedForeground }]}>
          Below {CLAN_MIN_ACTIVE} members a clan is forming: no raids, no rank. Once formed, it meets a clan of similar rank in a raid every
          week, and its score ranks it on the global board.
        </Text>
        <Text style={[type.body, { color: colors.mutedForeground }]}>
          The clan score counts active members. Anyone quiet for 5 days in a row stops counting until they return, and the leader can make room
          for someone who will show up.
        </Text>
        <Text style={[type.body, { color: colors.mutedForeground }]}>Founding a clan needs PRO and a verified email. Joining is free.</Text>
      </Sheet>

      <Sheet visible={sheet === "board"} title="Clan rankings" onClose={close}>
        {board.data ? (
          <Board items={board.data} mine={data.clan?.id} />
        ) : board.isError ? (
          <Notice message="The board is out of reach." onRetry={() => void board.refetch()} />
        ) : (
          <ActivityIndicator color={colors.primary} />
        )}
      </Sheet>

      <Sheet visible={sheet === "raid" && !!raid} title="Weekly raid" onClose={close}>
        {raid ? <RaidStandings raid={raid} /> : null}
      </Sheet>

      <Sheet visible={sheet === "dispatches"} title="Dispatches" onClose={close}>
        {data.dispatches.length === 0 ? (
          <Text style={[type.body, { color: colors.mutedForeground }]}>No dispatches yet.</Text>
        ) : (
          data.dispatches.map((d) => (
            <View key={d.id} style={s.dispatch}>
              <Text style={[type.meta, { color: colors.subtle }]}>{d.createdAt.slice(0, 10)}</Text>
              <Text style={[type.body, { color: colors.foreground }]}>{d.text}</Text>
            </View>
          ))
        )}
      </Sheet>
    </>
  );
}

const s = StyleSheet.create({
  loading: { marginTop: space.xl },
  head: { gap: space.xs },
  ctas: { gap: space.sm, marginTop: space.sm },
  dispatch: { gap: space.xs },
});
