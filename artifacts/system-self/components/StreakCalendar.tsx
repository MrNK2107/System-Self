import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { space, type } from "@/constants/type";
import { useColors } from "@/hooks/useColors";
import type { Domain, LogEntry } from "@/context/AppContext";
import { ALL_DOMAINS as DOMAINS, DOMAIN_COLORS } from "@/constants/domains";

interface Props {
  logs: LogEntry[];
  weeks?: number;
}

const localDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** One row per domain, one cell per day over the last N weeks; a filled cell means that domain was logged that day. */
export function StreakCalendar({ logs, weeks = 4 }: Props) {
  const colors = useColors();

  const days = weeks * 7;
  const dates: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    dates.push(localDay(d));
  }

  const logMap = new Map<string, Set<Domain>>();
  for (const log of logs) {
    const day = localDay(new Date(log.timestamp));
    if (!logMap.has(day)) logMap.set(day, new Set());
    logMap.get(day)!.add(log.domain);
  }

  const weekRows: string[][] = [];
  for (let w = 0; w < weeks; w++) weekRows.push(dates.slice(w * 7, w * 7 + 7));
  const today = localDay(new Date());

  return (
    <View style={styles.container}>
      {DOMAINS.map((domain) => {
        const color = DOMAIN_COLORS[domain];
        const count = dates.filter((d) => logMap.get(d)?.has(domain)).length;
        return (
          <View key={domain} style={styles.domainRow} accessible accessibilityLabel={`${domain}: logged on ${count} of ${days} days`}>
            <View style={[styles.dot, { backgroundColor: color }]} />
            {weekRows.map((week, wi) => (
              <View key={wi} style={styles.weekGroup}>
                {week.map((date) => {
                  const logged = logMap.get(date)?.has(domain) ?? false;
                  return (
                    <View
                      key={date}
                      style={[
                        styles.cell,
                        { backgroundColor: logged ? color : colors.muted, borderColor: date === today ? color : "transparent" },
                      ]}
                    />
                  );
                })}
              </View>
            ))}
          </View>
        );
      })}

      <View style={styles.domainRow}>
        <View style={styles.dotSpace} />
        {weekRows.map((week, wi) => (
          <View key={wi} style={styles.weekGroup}>
            <Text style={[type.meta, { color: colors.subtle }]} numberOfLines={1}>
              {week[0] ? new Date(week[0] + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" }) : ""}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: space.xs },
  domainRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
  dot: { width: 8, height: 8, borderRadius: 4 },
  dotSpace: { width: 8 },
  weekGroup: { flex: 1, flexDirection: "row", gap: 2 },
  cell: { flex: 1, aspectRatio: 1, borderRadius: 2, borderWidth: 1 },
});
