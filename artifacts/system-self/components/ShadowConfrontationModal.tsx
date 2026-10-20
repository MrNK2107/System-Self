import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { NoticeAction, NoticeFigure, NoticeShell, Typewriter } from "@/components/SystemNoticeModal";
import { ALL_DOMAINS as DOMAINS, DOMAIN_COLORS } from "@/constants/domains";
import { space, type } from "@/constants/type";
import { scoreRecord, useApp, type Domain } from "@/context/AppContext";
import { useColors } from "@/hooks/useColors";
import { useSystemAI } from "@/hooks/useSystemAI";

interface Props {
  visible: boolean;
  onClose: () => void;
}

/** [ SHADOW SELF ]: you against your shadow, domain by domain, the average lead, and the shadow's line. */
export function ShadowConfrontationModal({ visible, onClose }: Props) {
  const colors = useColors();
  const { user, domainScores, shadowSelf, getShadowScores, getShadowRank } = useApp();
  const { generateMessage } = useSystemAI();
  const [aiText, setAiText] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) {
      setAiText(null);
      return;
    }
    if (!user) return;
    let cancelled = false;
    void generateMessage("shadow_confrontation").then((text) => {
      if (!cancelled) setAiText(text);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  if (!visible) return null;

  const shadowScores = getShadowScores();
  const shadowRank = getShadowRank();
  const mine: Record<Domain, number> = scoreRecord(domainScores);
  const rows = DOMAINS.map((d) => ({ domain: d, you: mine[d], shadow: shadowScores[d], diff: shadowScores[d] - mine[d] }));
  const gap = rows.reduce((sum, r) => sum + r.diff, 0) / DOMAINS.length;
  const shadowLeads = gap > 0;
  const lead = shadowLeads ? colors.destructive : colors.success;

  return (
    <NoticeShell visible={visible} title="SHADOW SELF" frameColor={shadowLeads ? colors.destructive : undefined} onClose={onClose}>
      <View style={s.head}>
        <Text style={[type.title, s.center, { color: colors.foreground }]} selectable>
          {shadowSelf.codename}
        </Text>
        <Text style={[type.label, s.center, { color: colors.mutedForeground }]}>{`RANK ${shadowRank}`}</Text>
      </View>

      <View style={s.figure}>
        <NoticeFigure value={Math.abs(gap).toFixed(1)} unit={shadowLeads ? "SHADOW LEADS" : "YOU LEAD"} color={lead} />
        <Text style={[type.meta, s.center, { color: colors.mutedForeground }]}>Average points between you, across the five domains.</Text>
      </View>

      <View style={s.rows}>
        {rows.map((r) => {
          const ahead = r.diff > 0;
          return (
            <View
              key={r.domain}
              style={s.row}
              accessible
              accessibilityLabel={`${r.domain}: you ${r.you.toFixed(1)}, shadow ${r.shadow.toFixed(1)}`}
            >
              <View style={s.rowHead}>
                <View style={[s.dot, { backgroundColor: DOMAIN_COLORS[r.domain] }]} />
                <Text style={[type.label, s.flex, { color: colors.foreground }]}>{r.domain}</Text>
                <Text style={[type.meta, { color: ahead ? colors.destructive : colors.success }]}>
                  {ahead ? `Shadow +${r.diff.toFixed(1)}` : `You +${Math.abs(r.diff).toFixed(1)}`}
                </Text>
              </View>
              <Bar label="You" value={r.you} color={DOMAIN_COLORS[r.domain]} />
              <Bar label="Shadow" value={r.shadow} color={ahead ? colors.destructive : colors.subtle} />
            </View>
          );
        })}
      </View>

      <View style={s.line}>
        <Text style={[type.label, s.center, { color: lead }]}>{shadowLeads ? shadowSelf.codename : "THE SYSTEM"}</Text>
        {aiText === null ? (
          <Text style={[type.meta, s.center, { color: colors.subtle }]}>Receiving transmission.</Text>
        ) : (
          <Typewriter text={aiText} style={[type.body, s.center, { color: colors.foreground }]} />
        )}
      </View>

      <NoticeAction label="Close" onPress={onClose} />
    </NoticeShell>
  );
}

function Bar({ label, value, color }: { label: string; value: number; color: string }) {
  const colors = useColors();
  return (
    <View style={s.bar}>
      <Text style={[type.meta, s.barLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <View style={[s.track, { backgroundColor: colors.muted }]}>
        <View style={[s.fill, { width: `${Math.max(0, Math.min(100, value))}%`, backgroundColor: color }]} />
      </View>
      <Text style={[type.meta, s.barValue, { color: colors.foreground }]}>{value.toFixed(1)}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  head: { gap: space.xs },
  center: { textAlign: "center" },
  figure: { gap: space.xs },
  rows: { gap: space.md },
  row: { gap: space.xs },
  rowHead: { flexDirection: "row", alignItems: "center", gap: space.sm },
  dot: { width: 8, height: 8, borderRadius: 4 },
  flex: { flex: 1 },
  bar: { flexDirection: "row", alignItems: "center", gap: space.sm },
  barLabel: { width: 52 },
  track: { flex: 1, height: 4, borderRadius: 2, overflow: "hidden" },
  fill: { height: 4, borderRadius: 2 },
  barValue: { width: 40, textAlign: "right", fontVariant: ["tabular-nums"] },
  line: { gap: space.xs },
});
