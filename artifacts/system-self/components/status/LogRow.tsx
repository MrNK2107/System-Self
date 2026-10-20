// One logged entry: domain dot, what was logged, the note, the time. Used by Log history and a domain's detail.
import { summarizeLog } from "@workspace/engine";
import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { DOMAIN_COLORS } from "@/constants/domains";
import { space, type } from "@/constants/type";
import type { LogEntry } from "@/context/AppContext";
import { useColors } from "@/hooks/useColors";

export function LogRow({ entry, showDomain = true, showDate = false }: { entry: LogEntry; showDomain?: boolean; showDate?: boolean }) {
  const colors = useColors();
  // data.note carries the free text (toLogEntry), so a generic log's summary is its note: show it once.
  const summary = summarizeLog({ domain: entry.domain, logType: entry.type, data: entry.data, freeText: null });
  const note = typeof entry.data.note === "string" ? entry.data.note : "";
  const showNote = note !== "" && note !== summary;
  const date = new Date(entry.timestamp);
  const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const day = date.toLocaleDateString([], { month: "short", day: "numeric" });
  const kind = entry.type.replace(/_/g, " ");
  const intensity = entry.type === "generic" && typeof entry.data.intensity === "number" ? ` · intensity ${entry.data.intensity}/5` : "";
  const meta = [showDomain ? entry.domain : null, kind, showDate ? `${day}, ${time}` : time].filter(Boolean).join(" · ") + intensity;

  return (
    <View style={[s.row, { borderBottomColor: colors.border }]} accessible accessibilityLabel={`${summary}. ${meta}${entry.pending ? ". Queued" : ""}`}>
      <View style={[s.dot, { backgroundColor: DOMAIN_COLORS[entry.domain] }]} />
      <View style={s.text}>
        <Text style={[type.body, { color: colors.foreground }]} numberOfLines={2}>
          {summary}
        </Text>
        {showNote ? (
          <Text style={[type.body, { color: colors.mutedForeground }]} numberOfLines={2}>
            {note}
          </Text>
        ) : null}
        <Text style={[type.meta, { color: colors.subtle }]}>{meta}</Text>
      </View>
      {entry.pending ? <Text style={[type.label, { color: colors.warn }]}>QUEUED</Text> : null}
    </View>
  );
}

const s = StyleSheet.create({
  row: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space.md,
    paddingVertical: space.sm + 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 7 },
  text: { flex: 1, gap: 2 },
});
