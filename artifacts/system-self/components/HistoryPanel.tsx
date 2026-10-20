// Stats: score history (one line per domain, rank-change markers) and the Rank Freeze control.
// Lines use the domain colour; rank markers and quest bars use muted text (violet is kept for pressable things).
// Fewer than two days of history shows one System line instead of an empty chart.
import React, { useMemo, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TextInput, View, type LayoutChangeEvent } from "react-native";
import Svg, { Line, Path, Rect, Text as SvgText } from "react-native-svg";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, api } from "@/lib/api/client";
import { useColors } from "@/hooks/useColors";
import { useGameUserId } from "@/hooks/useGameState";
import { usePro } from "@/hooks/usePro";
import { ProLock } from "@/components/ProLock";
import { Button } from "@/components/ui/Button";
import { ALL_DOMAINS, DOMAIN_COLORS } from "@/constants/domains";
import { space, type } from "@/constants/type";
import type { Domain } from "@/context/AppContext";
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
import { HISTORY_NOT_READY_LINE, historyReady } from "@/lib/status/status";

const CHART_H = 40;
const LABEL_H = 16;

/** Width of the container, so charts fill the column on any phone. */
function useWidth(initial = 280): [number, (e: LayoutChangeEvent) => void] {
  const [w, setW] = useState(initial);
  return [w, (e) => {
    const next = Math.floor(e.nativeEvent.layout.width);
    if (next > 0 && next !== w) setW(next);
  }];
}

/** Score history for every domain, or one (`domain`) on its detail screen. Quest completion shows with all domains. */
export function HistoryPanel({ domain }: { domain?: Domain } = {}) {
  const colors = useColors();
  const userId = useGameUserId();
  const pro = usePro();
  const [chartW, onLayout] = useWidth();
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
    return span > 1 ? (o * chartW) / (span - 1) : 0;
  };
  const trendQ = useQuery({
    queryKey: questTrendKey(userId, days),
    queryFn: () => fetchQuestTrend(api, days),
    enabled: !!userId && !domain,
  });
  const bars = !domain && trendQ.data && historyReady(trendQ.data.items) ? barRects(trendQ.data.items, trendQ.data.from, trendQ.data.days, chartW, CHART_H) : [];
  const shown = domain ? [domain] : ALL_DOMAINS;

  return (
    <View style={s.panel} onLayout={onLayout}>
      <View style={s.header}>
        <Text style={[type.label, { color: colors.mutedForeground }]}>SCORE HISTORY</Text>
        <Text style={[type.meta, { color: colors.subtle }]}>{historyQ.data ? `${historyQ.data.days} days` : ""}</Text>
      </View>
      {historyQ.isLoading ? (
        <ActivityIndicator color={colors.primary} />
      ) : historyQ.isError && items.length === 0 ? (
        <Text style={[type.body, { color: colors.mutedForeground }]}>History is out of reach.</Text>
      ) : !historyReady(items) ? (
        <Text style={[type.body, { color: colors.mutedForeground }]}>{HISTORY_NOT_READY_LINE}</Text>
      ) : (
        shown.map((d) => (
          <View key={d} style={s.row} accessible accessibilityLabel={`${d} score history`}>
            {!domain && (
              <View style={s.rowHead}>
                <View style={[s.dot, { backgroundColor: DOMAIN_COLORS[d] }]} />
                <Text style={[type.label, { color: colors.foreground }]}>{d}</Text>
              </View>
            )}
            <Svg width={chartW} height={CHART_H + LABEL_H} viewBox={`0 -2 ${chartW} ${CHART_H + LABEL_H}`}>
              {changes.map((c) => (
                <Line key={`l${c.index}`} x1={xAt(c.index)} x2={xAt(c.index)} y1={0} y2={CHART_H} stroke={colors.subtle} strokeWidth={1} strokeDasharray="2 3" />
              ))}
              <Path d={seriesPath(domainSeries(items, d), from, span, chartW, CHART_H)} stroke={DOMAIN_COLORS[d]} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" fill="none" />
              {changes.map((c) => (
                <SvgText key={`t${c.index}`} x={Math.min(xAt(c.index) + 3, chartW - 10)} y={CHART_H + 12} fontSize={12} fontWeight="600" fill={colors.mutedForeground}>
                  {c.to}
                </SvgText>
              ))}
            </Svg>
          </View>
        ))
      )}
      {bars.length > 0 && (
        <View style={s.row} accessible accessibilityLabel="Quest completion trend">
          <Text style={[type.label, { color: colors.foreground }]}>QUEST COMPLETION</Text>
          <Svg width={chartW} height={CHART_H}>
            <Line x1={0} x2={chartW} y1={CHART_H} y2={CHART_H} stroke={colors.border} strokeWidth={1} />
            {bars.map((b, i) => (
              <Rect key={i} x={b.x} y={b.y} width={b.width} height={b.height} fill={colors.mutedForeground} />
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

  const note = (text: string) => <Text style={[type.body, { color: colors.mutedForeground }]}>{text}</Text>;

  return (
    <View style={s.panel}>
      <Text style={[type.label, { color: colors.mutedForeground }]} accessibilityRole="header">RANK FREEZE</Text>
      {mode === "active" && view.kind === "active" ? (
        <>
          <Text style={[type.bodyStrong, { color: colors.foreground }]}>{view.line}</Text>
          {note(`Through ${view.until}.`)}
        </>
      ) : mode === "locked" ? (
        <>
          {note(FREEZE_PITCH)}
          <ProLock label="RANK FREEZE" />
        </>
      ) : view.kind === "wait" ? (
        note(`Available from ${view.availableFrom}.`)
      ) : !open ? (
        <>
          {note(FREEZE_PITCH_PRO)}
          <Button label="Freeze rank" variant="tonal" onPress={() => setOpen(true)} />
        </>
      ) : (
        <>
          <TextInput
            value={reason}
            onChangeText={setReason}
            maxLength={REASON_MAX}
            placeholder="Reason"
            placeholderTextColor={colors.subtle}
            accessibilityLabel="Rank Freeze reason"
            style={[type.body, s.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.card }]}
          />
          <View style={s.actions}>
            <Button label="Confirm 7 days" onPress={confirm} loading={start.isPending} />
            <Button label="Cancel" variant="text" onPress={() => { setOpen(false); setMessage(null); }} />
          </View>
        </>
      )}
      {message && <Text style={[type.body, { color: colors.destructive }]}>{message}</Text>}
    </View>
  );
}

const s = StyleSheet.create({
  panel: { gap: space.sm + 4 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  row: { gap: space.xs },
  rowHead: { flexDirection: "row", alignItems: "center", gap: space.sm },
  dot: { width: 8, height: 8, borderRadius: 4 },
  input: { borderWidth: 1, borderRadius: 4, paddingHorizontal: space.sm + 4, minHeight: 48 },
  actions: { flexDirection: "row", gap: space.sm, alignItems: "center" },
});
