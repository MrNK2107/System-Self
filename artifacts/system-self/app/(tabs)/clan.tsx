// Clan tab: the user's clan (GET /api/clans/mine) polled every minute while focused, or the way in (found / join)
// and the global clan board. Members are shown by username (inside a clan there is no anonymity, PRD 16); the
// hidden score never reaches the app — only the clan score.
import React, { useState } from "react";
import { Alert, Platform, RefreshControl, ScrollView, Share, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { ClanLeaderboardItem, MyClanResponse } from "@workspace/contracts";
import { ScreenStatus } from "@/components/ScreenStatus";
import { useColors } from "@/hooks/useColors";
import { useClanActions, useClanLeaderboardQuery, useMyClanQuery, useRaidQuery } from "@/hooks/useClan";
import { RAID_TYPE_RULE, raidMetricLabel, raidPositionLine, raidTimeLeft, raidTitle, raidValueLabel } from "@/lib/clan/raid";
import {
  SYNC_PENDING_MESSAGE,
  clanLabel,
  clanStatusLine,
  describeClanError,
  leaveBlocker,
  leaveDisbands,
  scoreLabel,
} from "@/lib/clan/clan";

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  const colors = useColors();
  return (
    <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Text style={[s.sectionLabel, { color: colors.mutedForeground }]}>{label}</Text>
      {children}
    </View>
  );
}

function Board({ items, mine }: { items: ClanLeaderboardItem[]; mine?: string }) {
  const colors = useColors();
  if (items.length === 0) {
    return <Text style={[s.muted, { color: colors.mutedForeground }]}>No ranked clans yet. A clan ranks once it holds 8 operators, 3 of them active.</Text>;
  }
  return (
    <View style={s.list}>
      {items.map((c) => (
        <View key={c.id} style={[s.boardRow, { borderColor: c.id === mine ? colors.primary + "60" : colors.border }]}>
          <Text style={[s.pos, { color: c.clanRank === 1 ? "#D4B483" : colors.mutedForeground }]}>#{c.clanRank}</Text>
          <Text style={[s.boardName, { color: c.id === mine ? colors.primary : colors.foreground }]} numberOfLines={1}>
            {clanLabel(c)}
          </Text>
          <Text style={[s.mono, { color: colors.foreground }]}>{scoreLabel(c.clanScore)}</Text>
        </View>
      ))}
    </View>
  );
}

/** This week's raid: type, standings (clan totals only), your clan's metric and the time left. Polled while focused. */
function RaidCard() {
  const colors = useColors();
  const q = useRaidQuery(true);
  const raid = q.data;
  if (!raid) {
    return (
      <Section label="WEEKLY RAID">
        <Text style={[s.muted, { color: colors.mutedForeground }]}>
          {q.isError ? "The raid record is out of reach." : "No raid this week. A raid needs a rival clan of similar rank."}
        </Text>
      </Section>
    );
  }
  return (
    <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.primary + "40" }]}>
      <Text style={[s.sectionLabel, { color: colors.mutedForeground }]}>WEEKLY RAID</Text>
      <Text style={[s.clanName, { color: colors.foreground }]}>{raidTitle(raid)}</Text>
      <Text style={[s.muted, { color: colors.mutedForeground }]}>{RAID_TYPE_RULE[raid.type]}</Text>
      <Text style={[s.status, { color: colors.primary }]}>
        {raid.resolved ? "CLOSED" : raidTimeLeft(raid.endsAt, new Date()).toUpperCase()} · {raidPositionLine(raid)}
      </Text>
      <View style={s.list}>
        {raid.standings.map((c) => (
          <View key={c.clanId} style={[s.boardRow, { borderColor: c.isMine ? colors.primary + "60" : colors.border }]}>
            <Text style={[s.pos, { color: c.position === 1 ? "#D4B483" : colors.mutedForeground }]}>#{c.position}</Text>
            <Text style={[s.boardName, { color: c.isMine ? colors.primary : colors.foreground }]} numberOfLines={1}>
              {clanLabel(c)}
            </Text>
            <Text style={[s.mono, { color: colors.foreground }]}>{raidValueLabel(raid.type, c.metricValue)}</Text>
          </View>
        ))}
      </View>
      <Text style={[s.statLabel, { color: colors.mutedForeground }]}>
        {raidMetricLabel(raid.type).toUpperCase()} · YOUR CLAN {raidValueLabel(raid.type, raid.myValue)}
      </Text>
    </View>
  );
}

function MyClan({ data, onError }: { data: MyClanResponse; onError: (m: string | null) => void }) {
  const colors = useColors();
  const actions = useClanActions();
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

  const flagged = data.members.filter((m) => m.flagged).length;

  return (
    <>
      <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.primary + "40" }]}>
        <Text style={[s.clanName, { color: colors.foreground }]}>{clanLabel(clan)}</Text>
        {clan.description ? <Text style={[s.muted, { color: colors.mutedForeground }]}>{clan.description}</Text> : null}
        <Text style={[s.status, { color: clan.status === "active" ? colors.primary : "#C4873A" }]}>{clanStatusLine(clan)}</Text>
        <View style={s.statRow}>
          <View style={s.stat}>
            <Text style={[s.statVal, { color: colors.foreground }]}>{scoreLabel(clan.clanScore)}</Text>
            <Text style={[s.statLabel, { color: colors.mutedForeground }]}>CLAN SCORE</Text>
          </View>
          <View style={s.stat}>
            <Text style={[s.statVal, { color: colors.foreground }]}>{clan.clanRank ? `#${clan.clanRank}` : "—"}</Text>
            <Text style={[s.statLabel, { color: colors.mutedForeground }]}>GLOBAL RANK</Text>
          </View>
          <View style={s.stat}>
            <Text style={[s.statVal, { color: colors.foreground }]}>{clan.raidWins}</Text>
            <Text style={[s.statLabel, { color: colors.mutedForeground }]}>RAID WINS</Text>
          </View>
        </View>
        <TouchableOpacity
          onPress={() => void Share.share({ message: `Join ${clanLabel(clan)} on SYSTEM // SELF. Invite code: ${clan.inviteCode}` }).catch(() => {})}
          accessibilityRole="button"
          accessibilityLabel={`Share invite code ${clan.inviteCode}`}
          style={[s.invite, { borderColor: colors.border }]}
        >
          <Text style={[s.statLabel, { color: colors.mutedForeground }]}>INVITE CODE</Text>
          <Text style={[s.code, { color: colors.foreground }]} selectable>
            {clan.inviteCode}
          </Text>
          <Feather name="share-2" size={12} color={colors.primary} />
        </TouchableOpacity>
      </View>

      <RaidCard />

      <TouchableOpacity
        onPress={() => router.push("/clan/members")}
        accessibilityRole="button"
        style={[s.card, s.linkRow, { backgroundColor: colors.card, borderColor: colors.border }]}
      >
        <View style={{ flex: 1 }}>
          <Text style={[s.sectionLabel, { color: colors.mutedForeground }]}>ROSTER</Text>
          <Text style={[s.linkText, { color: colors.foreground }]}>
            {clan.memberCount} operators · {clan.activeMemberCount} active{flagged > 0 ? ` · ${flagged} flagged dead weight` : ""}
          </Text>
        </View>
        <Feather name="chevron-right" size={14} color={colors.mutedForeground} />
      </TouchableOpacity>

      <TouchableOpacity
        onPress={() => router.push("/clan/rate")}
        accessibilityRole="button"
        style={[s.card, s.linkRow, { backgroundColor: colors.card, borderColor: colors.border }]}
      >
        <View style={{ flex: 1 }}>
          <Text style={[s.sectionLabel, { color: colors.mutedForeground }]}>PEER RATINGS</Text>
          <Text style={[s.linkText, { color: colors.foreground }]}>Rate your clanmates. Anonymous.</Text>
        </View>
        <Feather name="chevron-right" size={14} color={colors.mutedForeground} />
      </TouchableOpacity>

      <Section label="DISPATCHES">
        {data.dispatches.length === 0 ? (
          <Text style={[s.muted, { color: colors.mutedForeground }]}>No dispatches yet.</Text>
        ) : (
          data.dispatches.map((d) => (
            <View key={d.id} style={s.dispatch}>
              <Text style={[s.dispatchDate, { color: colors.mutedForeground }]}>{d.createdAt.slice(0, 10)}</Text>
              <Text style={[s.dispatchText, { color: colors.foreground }]}>{d.text}</Text>
            </View>
          ))
        )}
      </Section>

      <TouchableOpacity onPress={leave} disabled={busy} accessibilityRole="button" style={[s.leave, { borderColor: colors.destructive }]}>
        <Text style={[s.leaveText, { color: busy ? colors.subtle : colors.foreground }]}>
          {leaveDisbands(data) ? "DISBAND CLAN" : "LEAVE CLAN"}
        </Text>
      </TouchableOpacity>
    </>
  );
}

export default function ClanScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const q = useMyClanQuery();
  const board = useClanLeaderboardQuery();
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([q.refetch(), board.refetch()]);
    } finally {
      setRefreshing(false);
    }
  };

  if (!q.data) {
    return <ScreenStatus failed={q.isError} message="The clan record is out of reach. Check your connection." onRetry={() => void q.refetch()} />;
  }

  return (
    <View style={[s.container, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={[s.scroll, { paddingTop: topPad + 16, paddingBottom: insets.bottom + 90 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        <Text style={[s.title, { color: colors.foreground }]}>CLAN</Text>
        {message ? (
          <View style={[s.notice, { borderColor: colors.destructive }]}>
            <Text style={[s.noticeText, { color: colors.foreground }]}>{message}</Text>
          </View>
        ) : null}

        {q.data.clan ? (
          <MyClan data={q.data} onError={setMessage} />
        ) : (
          <Section label="NO CLAN">
            <Text style={[s.muted, { color: colors.mutedForeground }]}>
              Clans hold 8 to 30 operators. Members see each other by username. Dead weight is flagged and can be removed.
            </Text>
            <View style={s.ctaRow}>
              <TouchableOpacity onPress={() => router.push("/clan/join")} accessibilityRole="button" style={[s.cta, { backgroundColor: colors.accentFill }]}>
                <Text style={[s.ctaText, { color: colors.primaryForeground }]}>JOIN A CLAN</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => router.push("/clan/create")} accessibilityRole="button" style={[s.cta, { borderColor: colors.primary, borderWidth: 1 }]}>
                <Text style={[s.ctaText, { color: colors.primary }]}>FOUND A CLAN</Text>
              </TouchableOpacity>
            </View>
          </Section>
        )}

        <Section label="GLOBAL CLAN RANK">
          {board.data ? (
            <Board items={board.data} mine={q.data.clan?.id} />
          ) : (
            <Text style={[s.muted, { color: colors.mutedForeground }]}>{board.isError ? "The board is out of reach." : "Loading."}</Text>
          )}
        </Section>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  scroll: { paddingHorizontal: 16, gap: 12 },
  title: { fontSize: 22, fontWeight: "800" as const, letterSpacing: 4 },
  card: { borderWidth: 1, borderRadius: 4, padding: 14, gap: 8 },
  sectionLabel: { fontSize: 9, fontWeight: "800" as const, letterSpacing: 2.5 },
  muted: { fontSize: 12, lineHeight: 18 },
  list: { gap: 6 },
  boardRow: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: 3, paddingHorizontal: 10, paddingVertical: 8 },
  pos: { width: 34, fontSize: 11, fontWeight: "800" as const },
  boardName: { flex: 1, fontSize: 12, fontWeight: "700" as const, letterSpacing: 1 },
  mono: { fontFamily: "SpaceMono", fontSize: 12 },
  clanName: { fontSize: 17, fontWeight: "800" as const, letterSpacing: 2 },
  status: { fontSize: 10, fontWeight: "700" as const, letterSpacing: 1.5 },
  statRow: { flexDirection: "row", gap: 8, marginTop: 4 },
  stat: { flex: 1, gap: 2 },
  statVal: { fontSize: 18, fontWeight: "800" as const, fontFamily: "SpaceMono" },
  statLabel: { fontSize: 8, fontWeight: "800" as const, letterSpacing: 2 },
  invite: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: 3, padding: 10, marginTop: 4 },
  code: { flex: 1, fontSize: 14, fontWeight: "800" as const, letterSpacing: 3, fontFamily: "SpaceMono" },
  linkRow: { flexDirection: "row", alignItems: "center" },
  linkText: { fontSize: 13, fontWeight: "700" as const },
  dispatch: { gap: 2 },
  dispatchDate: { fontSize: 9, letterSpacing: 1.5, fontWeight: "700" as const },
  dispatchText: { fontSize: 12, lineHeight: 17 },
  leave: { borderWidth: 1, borderRadius: 4, padding: 12, alignItems: "center" },
  leaveText: { fontSize: 11, fontWeight: "800" as const, letterSpacing: 2.5 },
  notice: { borderLeftWidth: 2, paddingHorizontal: 10, paddingVertical: 8 },
  noticeText: { fontSize: 12, lineHeight: 17 },
  ctaRow: { flexDirection: "row", gap: 8, marginTop: 4 },
  cta: { flex: 1, borderRadius: 4, paddingVertical: 12, alignItems: "center" },
  ctaText: { fontSize: 11, fontWeight: "800" as const, letterSpacing: 2 },
});
