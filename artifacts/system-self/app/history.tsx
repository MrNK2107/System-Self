// Log history: every entry, grouped by day, newest first. Unsaved outbox items can be retried or dropped here.
import React, { useMemo, useState } from "react";
import { ActivityIndicator, SectionList, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { LogModal } from "@/components/LogModal";
import { LogRow } from "@/components/status/LogRow";
import { SystemLine } from "@/components/status/parts";
import { Button } from "@/components/ui/Button";
import { IconButton, Screen } from "@/components/ui/Screen";
import { space, type } from "@/constants/type";
import { useApp, type LogEntry } from "@/context/AppContext";
import { useColors } from "@/hooks/useColors";
import { useLogsQuery } from "@/hooks/useGameState";
import { groupByDay } from "@/lib/status/status";

/** Outbox items the server rejected (or that kept failing): retry them or drop them. */
function UnsavedBanner() {
  const colors = useColors();
  const { failedCount, retryFailed, discardFailed } = useApp();
  const [busy, setBusy] = useState(false);
  if (failedCount === 0) return null;

  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[s.unsaved, { borderColor: colors.destructive, backgroundColor: colors.card }]}>
      <Text style={[type.body, { color: colors.foreground }]}>
        {failedCount === 1 ? "1 entry was not saved." : `${failedCount} entries were not saved.`}
      </Text>
      <View style={s.row}>
        <Button label="Retry" variant="tonal" onPress={() => void run(retryFailed)} disabled={busy} />
        <Button label="Discard" variant="text" onPress={() => void run(discardFailed)} disabled={busy} />
      </View>
    </View>
  );
}

const localDay = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

function dayTitle(day: string): string {
  const today = localDay(new Date().toISOString());
  const y = new Date();
  y.setDate(y.getDate() - 1);
  if (day === today) return "Today";
  if (day === localDay(y.toISOString())) return "Yesterday";
  return new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

export default function LogHistoryScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { logs } = useApp();
  const logsQuery = useLogsQuery();
  const [logVisible, setLogVisible] = useState(false);

  const sections = useMemo(
    () => groupByDay<LogEntry>(logs, localDay).map((g) => ({ title: dayTitle(g.day), count: g.items.length, data: g.items })),
    [logs],
  );

  return (
    <Screen title="Log history" back scroll={false} action={<IconButton icon="plus" label="Log an entry" onPress={() => setLogVisible(true)} />}>
      {logsQuery.isPending && sections.length === 0 ? (
        <View style={s.empty}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : logsQuery.isError && !logsQuery.data && sections.length === 0 ? (
        <View style={s.empty}>
          <SystemLine>The log archive is out of reach. Check your connection.</SystemLine>
          <Button label="Retry" variant="tonal" onPress={() => void logsQuery.refetch()} style={s.centered} />
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <LogRow entry={item} />}
          renderSectionHeader={({ section }) => (
            <View style={[s.header, { backgroundColor: colors.background }]}>
              <Text style={[type.label, s.flex, { color: colors.mutedForeground }]} accessibilityRole="header">
                {section.title.toUpperCase()}
              </Text>
              <Text style={[type.meta, { color: colors.subtle }]}>{section.count === 1 ? "1 entry" : `${section.count} entries`}</Text>
            </View>
          )}
          ListHeaderComponent={<UnsavedBanner />}
          stickySectionHeadersEnabled
          contentContainerStyle={[s.list, { paddingBottom: insets.bottom + space.lg }, sections.length === 0 && s.grow]}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={s.empty}>
              <SystemLine>No logs yet. Every entry is permanent.</SystemLine>
              <Button label="Log the first entry" onPress={() => setLogVisible(true)} style={s.centered} />
            </View>
          }
        />
      )}

      <LogModal visible={logVisible} onClose={() => setLogVisible(false)} />
    </Screen>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1 },
  grow: { flexGrow: 1 },
  centered: { alignSelf: "center" },
  list: { paddingHorizontal: space.md },
  header: { flexDirection: "row", alignItems: "center", paddingTop: space.lg, paddingBottom: space.xs },
  row: { flexDirection: "row", gap: space.sm, alignItems: "center" },
  unsaved: { borderWidth: 1, borderRadius: 4, padding: space.md, gap: space.sm, marginTop: space.sm },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: space.md, paddingHorizontal: space.xl },
});
