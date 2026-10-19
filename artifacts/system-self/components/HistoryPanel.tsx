// Stats: score history (one line per domain, rank-change markers) and the Rank Freeze control.
// Lines and marker labels use the readable accent text (colors.primary); accentFill is for the confirm button's fill only.
import React, { useMemo, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import Svg, { Line, Path, Rect, Text as SvgText } from "react-native-svg";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, api } from "@/lib/api/client";
import { useColors } from "@/hooks/useColors";
import { useGameUserId } from "@/hooks/useGameState";
import { usePro } from "@/hooks/usePro";
import { ProLock } from "@/components/ProLock";
import { ALL_DOMAINS } from "@/constants/domains";
import { newClientId } from "@/lib/game/actions";
import {
  FREE_CHART_DAYS,
  PRO_CHART_DAYS,
  REASON_MAX,
  FREEZE_PITCH,
  FREEZE_PITCH_PRO,
  checkFreezeReason,
  domainSeries,
  freezeCardMode,
  fetchRankFreeze,
  fetchScoreHistory,
  freezeView,
  isProRequired,
  barRects,
  dayOffset,
  fetchQuestTrend,
  questTrendKey,
  seriesPath,
  rankChanges,
  rankFreezeKey,
  scoreHistoryKey,
  startRankFreeze,
} from "@/lib/history/history";

const CHART_W = 280;
const CHART_H = 36;

export function HistoryPanel() {
  const colors = useColors();
  const userId = useGameUserId();
  const pro = usePro();
  const days = pro ? PRO_CHART_DAYS : FREE_CHART_DAYS;
  const historyQ = useQuery({
    queryKey: scoreHistoryKey(userId, days),
    queryFn: () => fetchScoreHistory(api, days),
    enabled: !!userId,
  });
  const items = historyQ.data?.items ?? [];
  const changes = useMemo(() => rankChanges(items), [items]);
  const from = historyQ.data?.from ?? "";
  const span = historyQ.data?.days ?? 0;
  const xAt = (i: number) => {
    const o = dayOffset(from, items[i]!.date);
    return span > 1 ? (o * CHART_W) / (span - 1) : 0;
  };
  const trendQ = useQuery({
    queryKey: questTrendKey(userId, days),
    queryFn: () => fetchQuestTrend(api, days),
    enabled: !!userId,
  });
  const bars = trendQ.data ? barRects(trendQ.data.items, trendQ.data.from, trendQ.data.days, CHART_W, CHART_H) : [];

  return (
    <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={s.header}>
        <Text style={[s.title, { color: colors.mutedForeground }]}>SCORE HISTORY</Text>
        <Text style={[s.sub, { color: colors.mutedForeground }]}>{historyQ.data ? `${historyQ.data.days} DAYS` : ""}</Text>
      </View>
      {historyQ.isLoading ? (
        <ActivityIndicator color={colors.primary} />
      ) : historyQ.isError && items.length === 0 ? (
        <Text style={[s.note, { color: colors.mutedForeground }]}>History unavailable.</Text>
      ) : items.length === 0 ? (
        <Text style={[s.note, { color: colors.mutedForeground }]}>No history yet. The first day closes at rollover.</Text>
      ) : (
        ALL_DOMAINS.map((d) => (
          <View key={d} style={s.row} accessible accessibilityLabel={`${d} score history`}>
            <Text style={[s.domain, { color: colors.foreground }]}>{d}</Text>
            <Svg width={CHART_W} height={CHART_H + 12} viewBox={`0 -2 ${CHART_W} ${CHART_H + 12}`}>
              {changes.map((c) => (
                <Line key={`l${c.index}`} x1={xAt(c.index)} x2={xAt(c.index)} y1={0} y2={CHART_H} stroke={colors.mutedForeground} strokeWidth={1} strokeDasharray="2 3" />
              ))}
              <Path d={seriesPath(domainSeries(items, d), from, span, CHART_W, CHART_H)} stroke={colors.primary} strokeWidth={1.5} fill="none" />
              {changes.map((c) => (
                <SvgText key={`t${c.index}`} x={Math.min(xAt(c.index) + 3, CHART_W - 8)} y={CHART_H + 10} fontSize={9} fontWeight="700" fill={colors.primary}>
                  {c.to}
                </SvgText>
              ))}
            </Svg>
          </View>
        ))
      )}
      {bars.length > 0 && (
        <View style={s.row} accessible accessibilityLabel="Quest completion trend">
          <Text style={[s.domain, { color: colors.foreground }]}>QUEST COMPLETION</Text>
          <Svg width={CHART_W} height={CHART_H}>
            <Line x1={0} x2={CHART_W} y1={CHART_H} y2={CHART_H} stroke={colors.border} strokeWidth={1} />
            {bars.map((b, i) => (
              <Rect key={i} x={b.x} y={b.y} width={b.width} height={b.height} fill={colors.primary} />
            ))}
          </Svg>
        </View>
      )}
      {!pro && <ProLock label="FULL HISTORY" />}
    </View>
  );
}

export function RankFreezeCard() {
  const colors = useColors();
  const userId = useGameUserId();
  const pro = usePro();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const attemptKey = useRef<string | null>(null);

  // Fetched for everyone: a freeze started while PRO stays active (and shown) after PRO lapses.
  const statusQ = useQuery({ queryKey: rankFreezeKey(userId), queryFn: () => fetchRankFreeze(api), enabled: !!userId });
  const view = freezeView(statusQ.data);
  const mode = freezeCardMode(pro, view);

  const start = useMutation({
    mutationFn: () => startRankFreeze(api, reason, (attemptKey.current ??= newClientId("freeze"))),
    onSuccess: async () => {
      attemptKey.current = null;
      setOpen(false);
      setReason("");
      setMessage(null);
      await qc.invalidateQueries({ queryKey: rankFreezeKey(userId) });
    },
    onError: (err) => {
      if (err instanceof ApiError && err.kind === "http") attemptKey.current = null; // a refusal is final; a network error retries with the same key
      if (isProRequired(err)) setMessage("Rank Freeze is PRO.");
      else if (err instanceof ApiError && err.code === "freeze_used") setMessage("Already used this month.");
      else if (err instanceof ApiError && err.code === "freeze_active") setMessage("A freeze is already active.");
      else if (err instanceof ApiError && err.code === "freeze_cooldown") setMessage("Too soon after the last freeze.");
      else setMessage("The System is out of reach. Try again.");
      void qc.invalidateQueries({ queryKey: rankFreezeKey(userId) });
    },
  });

  const confirm = () => {
    const bad = checkFreezeReason(reason);
    if (bad) return setMessage(bad);
    setMessage(null);
    start.mutate();
  };

  return (
    <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Text style={[s.title, { color: colors.mutedForeground }]}>RANK FREEZE</Text>
      {mode === "active" && view.kind === "active" ? (
        <>
          <Text style={[s.line, { color: colors.primary }]}>{view.line}</Text>
          <Text style={[s.note, { color: colors.mutedForeground }]}>Through {view.until}.</Text>
        </>
      ) : mode === "locked" ? (
        <>
          <Text style={[s.note, { color: colors.mutedForeground }]}>{FREEZE_PITCH}</Text>
          <ProLock label="RANK FREEZE" />
        </>
      ) : view.kind === "active" ? (
        <>
          <Text style={[s.line, { color: colors.primary }]}>{view.line}</Text>
          <Text style={[s.note, { color: colors.mutedForeground }]}>Through {view.until}.</Text>
        </>
      ) : view.kind === "wait" ? (
        <Text style={[s.note, { color: colors.mutedForeground }]}>Available from {view.availableFrom}.</Text>
      ) : !open ? (
        <>
          <Text style={[s.note, { color: colors.mutedForeground }]}>{FREEZE_PITCH_PRO}</Text>
          <TouchableOpacity onPress={() => setOpen(true)} accessibilityRole="button" style={[s.outline, { borderColor: colors.primary }]}>
            <Text style={[s.outlineText, { color: colors.primary }]}>FREEZE RANK</Text>
          </TouchableOpacity>
        </>
      ) : (
        <>
          <TextInput
            value={reason}
            onChangeText={setReason}
            maxLength={REASON_MAX}
            placeholder="Reason"
            placeholderTextColor={colors.mutedForeground}
            accessibilityLabel="Rank Freeze reason"
            style={[s.input, { color: colors.foreground, borderColor: colors.border }]}
          />
          <View style={s.actions}>
            <TouchableOpacity onPress={confirm} disabled={start.isPending} accessibilityRole="button" style={[s.fill, { backgroundColor: colors.accentFill }]}>
              {start.isPending ? <ActivityIndicator color={colors.primaryForeground} /> : <Text style={[s.fillText, { color: colors.primaryForeground }]}>CONFIRM 7 DAYS</Text>}
            </TouchableOpacity>
            <TouchableOpacity onPress={() => { setOpen(false); setMessage(null); }} accessibilityRole="button" style={[s.outline, { borderColor: colors.border }]}>
              <Text style={[s.outlineText, { color: colors.mutedForeground }]}>CANCEL</Text>
            </TouchableOpacity>
          </View>
        </>
      )}
      {message && <Text style={[s.note, { color: colors.destructive ?? colors.mutedForeground }]}>{message}</Text>}
    </View>
  );
}

const s = StyleSheet.create({
  card: { padding: 16, borderRadius: 4, borderWidth: 1, gap: 12 },
  header: { flexDirection: "row", justifyContent: "space-between" },
  title: { fontSize: 9, letterSpacing: 3, fontWeight: "600" },
  sub: { fontSize: 9, letterSpacing: 2, fontWeight: "600" },
  row: { gap: 2 },
  domain: { fontSize: 10, letterSpacing: 2, fontWeight: "700" },
  note: { fontSize: 12, lineHeight: 18 },
  line: { fontSize: 13, fontWeight: "700", lineHeight: 20 },
  input: { borderWidth: 1, borderRadius: 3, paddingHorizontal: 10, paddingVertical: 8, fontSize: 13 },
  actions: { flexDirection: "row", gap: 8, alignItems: "center" },
  fill: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 3, minWidth: 120, alignItems: "center" },
  fillText: { fontSize: 10, fontWeight: "800", letterSpacing: 2 },
  outline: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 3, borderWidth: 1, alignSelf: "flex-start" },
  outlineText: { fontSize: 10, fontWeight: "800", letterSpacing: 2 },
});
