import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useColors } from "@/hooks/useColors";
import type { Domain, LogEntry } from "@/context/AppContext";

const DOMAIN_COLORS: Record<Domain, string> = {
  BODY: "#E05555", MIND: "#3A7BD5", WEALTH: "#4B8B6F", DISCIPLINE: "#C4873A",
};
const DOMAINS: Domain[] = ["BODY", "MIND", "WEALTH", "DISCIPLINE"];
const DOMAIN_ICONS: Record<Domain, string> = {
  BODY: "◈", MIND: "◉", WEALTH: "◆", DISCIPLINE: "▲",
};

interface Props {
  logs: LogEntry[];
  weeks?: number;
}

export function StreakCalendar({ logs, weeks = 4 }: Props) {
  const colors = useColors();

  // Build date range: last N*7 days
  const days = weeks * 7;
  const dates: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    dates.push(d.toISOString().split("T")[0]!);
  }

  // Build a map: date -> Set<Domain>
  const logMap = new Map<string, Set<Domain>>();
  for (const log of logs) {
    const day = log.timestamp.split("T")[0]!;
    if (!logMap.has(day)) logMap.set(day, new Set());
    logMap.get(day)!.add(log.domain);
  }

  // Group into weeks (rows)
  const weekRows: string[][] = [];
  for (let w = 0; w < weeks; w++) {
    weekRows.push(dates.slice(w * 7, w * 7 + 7));
  }

  const DAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"];

  const today = new Date().toISOString().split("T")[0]!;

  return (
    <View style={styles.container}>
      {/* Day labels */}
      <View style={styles.dayLabels}>
        <View style={styles.domainLabelCol} />
        {DAY_LABELS.map((d, i) => (
          <Text key={i} style={[styles.dayLabel, { color: colors.mutedForeground }]}>{d}</Text>
        ))}
      </View>

      {/* Domain rows */}
      {DOMAINS.map(domain => {
        const domColor = DOMAIN_COLORS[domain];
        return (
          <View key={domain} style={styles.domainRow}>
            <View style={styles.domainLabelCol}>
              <Text style={[styles.domainIcon, { color: domColor }]}>{DOMAIN_ICONS[domain]}</Text>
            </View>
            {/* Week columns */}
            {weekRows.map((week, wi) => (
              <View key={wi} style={styles.weekGroup}>
                {week.map((date, di) => {
                  const logged = logMap.get(date)?.has(domain) ?? false;
                  const isToday = date === today;
                  const isFuture = date > today;
                  return (
                    <View
                      key={di}
                      style={[
                        styles.cell,
                        {
                          backgroundColor: isFuture
                            ? "transparent"
                            : logged
                            ? domColor
                            : colors.muted,
                          borderColor: isToday
                            ? domColor
                            : logged
                            ? domColor + "40"
                            : "transparent",
                          borderWidth: isToday ? 1.5 : logged ? 0 : 0,
                          opacity: isFuture ? 0.2 : 1,
                        },
                      ]}
                    />
                  );
                })}
              </View>
            ))}
          </View>
        );
      })}

      {/* Week labels */}
      <View style={styles.weekLabels}>
        <View style={styles.domainLabelCol} />
        {weekRows.map((week, wi) => {
          const firstDate = week[0];
          const label = firstDate
            ? new Date(firstDate + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" })
            : "";
          return (
            <View key={wi} style={styles.weekLabelGroup}>
              <Text style={[styles.weekLabel, { color: colors.mutedForeground }]} numberOfLines={1}>
                {label}
              </Text>
            </View>
          );
        })}
      </View>

      <View style={styles.legend}>
        <View style={[styles.legendDot, { backgroundColor: colors.muted }]} />
        <Text style={[styles.legendText, { color: colors.mutedForeground }]}>No log</Text>
        <View style={[styles.legendDot, { backgroundColor: "#3A7BD5" }]} />
        <Text style={[styles.legendText, { color: colors.mutedForeground }]}>Logged</Text>
      </View>
    </View>
  );
}

const CELL_SIZE = 9;
const CELL_GAP = 3;

const styles = StyleSheet.create({
  container: { gap: 5 },
  dayLabels: { flexDirection: "row", alignItems: "center" },
  domainLabelCol: { width: 22 },
  dayLabel: { width: CELL_SIZE, textAlign: "center", fontSize: 7, fontWeight: "600" as const, marginRight: CELL_GAP },
  domainRow: { flexDirection: "row", alignItems: "center", gap: 0 },
  domainIcon: { fontSize: 9 },
  weekGroup: { flexDirection: "row", gap: CELL_GAP, marginRight: 6 },
  cell: { width: CELL_SIZE, height: CELL_SIZE, borderRadius: 2 },
  weekLabels: { flexDirection: "row", alignItems: "center", marginTop: 4 },
  weekLabelGroup: { width: 7 * (CELL_SIZE + CELL_GAP) + 6 - CELL_GAP, overflow: "hidden" },
  weekLabel: { fontSize: 7, letterSpacing: 0, fontWeight: "500" as const },
  legend: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 },
  legendDot: { width: 8, height: 8, borderRadius: 2 },
  legendText: { fontSize: 9, letterSpacing: 0.5 },
});
