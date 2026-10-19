import React, { useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { summarizeLog } from "@workspace/engine";
import { useColors } from "@/hooks/useColors";
import { useApp, type LogEntry } from "@/context/AppContext";
import { LogModal } from "@/components/LogModal";
import { DOMAIN_COLORS, DOMAIN_ICONS } from "@/constants/domains";
import { useLogsQuery } from "@/hooks/useGameState";

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
    <View style={[styles.unsaved, { borderColor: colors.destructive + "80", backgroundColor: colors.destructive + "14" }]}>
      <Feather name="alert-triangle" size={12} color="#E05555" />
      <Text style={[styles.unsavedText, { color: colors.foreground }]}>
        {failedCount === 1 ? "1 entry was not saved." : `${failedCount} entries were not saved.`}
      </Text>
      <TouchableOpacity onPress={() => void run(retryFailed)} disabled={busy} accessibilityRole="button" style={styles.unsavedBtn}>
        <Text style={[styles.unsavedAction, { color: colors.primary }]}>RETRY</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={() => void run(discardFailed)} disabled={busy} accessibilityRole="button" style={styles.unsavedBtn}>
        <Text style={[styles.unsavedAction, { color: colors.mutedForeground }]}>DISCARD</Text>
      </TouchableOpacity>
    </View>
  );
}

function LogItem({ entry }: { entry: LogEntry }) {
  const colors = useColors();
  const domainColor = DOMAIN_COLORS[entry.domain];
  const icon = DOMAIN_ICONS[entry.domain];

  // data.note carries the free text (toLogEntry), so a generic log's summary is its note: show it once.
  const summary = summarizeLog({ domain: entry.domain, logType: entry.type, data: entry.data, freeText: null });
  const note = typeof entry.data.note === "string" ? entry.data.note : "";
  const showNote = note !== "" && note !== summary;
  const date = new Date(entry.timestamp);
  const timeStr = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const dateStr = date.toLocaleDateString([], { month: "short", day: "numeric" });

  return (
    <View style={[styles.logItem, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={[styles.logIcon, { backgroundColor: domainColor + "20" }]}>
        <Feather name={icon} size={14} color={domainColor} />
      </View>
      <View style={styles.logContent}>
        <View style={styles.logHeader}>
          <Text style={[styles.logDomain, { color: domainColor }]}>{entry.domain}</Text>
          <Text style={[styles.logType, { color: colors.mutedForeground }]}>
            {entry.type.replace(/_/g, " ").toUpperCase()}
          </Text>
          {entry.pending && (
            <Text style={[styles.logPending, { color: colors.mutedForeground }]}>QUEUED</Text>
          )}
        </View>
        <Text style={[styles.logNote, { color: colors.foreground }]} numberOfLines={2}>
          {summary}
        </Text>
        {showNote ? (
          <Text style={[styles.logNote, { color: colors.foreground }]} numberOfLines={2}>
            {entry.data.note as string}
          </Text>
        ) : null}
        <Text style={[styles.logTime, { color: colors.mutedForeground }]}>
          {dateStr} · {timeStr}
          {entry.type === "generic" && typeof entry.data.intensity === "number" ? ` · intensity ${entry.data.intensity}/5` : ""}
        </Text>
      </View>
    </View>
  );
}

export default function LogScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { logs } = useApp();
  const logsQuery = useLogsQuery();
  const [logVisible, setLogVisible] = useState(false);

  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);
  const sortedLogs = [...logs].reverse();

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 16, borderBottomColor: colors.border }]}>
        <Text style={[styles.title, { color: colors.foreground }]}>LOG HISTORY</Text>
        <TouchableOpacity
          style={[styles.addBtn, { backgroundColor: colors.primary }]}
          onPress={() => setLogVisible(true)}
          activeOpacity={0.8}
        >
          <Feather name="plus" size={16} color="#fff" />
        </TouchableOpacity>
      </View>

      <UnsavedBanner />

      {logsQuery.isPending && sortedLogs.length === 0 ? (
        <View style={styles.empty}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : logsQuery.isError && !logsQuery.data && sortedLogs.length === 0 ? (
        <View style={styles.empty}>
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
            The log archive is out of reach. Check your connection.
          </Text>
          <TouchableOpacity onPress={() => void logsQuery.refetch()} accessibilityRole="button" style={styles.unsavedBtn}>
            <Text style={[styles.unsavedAction, { color: colors.primary }]}>RETRY</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={sortedLogs}
          keyExtractor={item => item.id}
          renderItem={({ item }) => <LogItem entry={item} />}
          contentContainerStyle={[
            styles.list,
            { paddingBottom: insets.bottom + 80 },
            sortedLogs.length === 0 && styles.emptyContainer,
          ]}
          showsVerticalScrollIndicator={false}
          scrollEnabled={sortedLogs.length > 0}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Feather name="inbox" size={32} color={colors.mutedForeground} />
              <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No logs yet.</Text>
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                Every entry is permanent. Start logging.
              </Text>
            </View>
          }
        />
      )}

      <LogModal visible={logVisible} onClose={() => setLogVisible(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: {
    fontSize: 14,
    fontWeight: "700" as const,
    letterSpacing: 3,
  },
  addBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  list: {
    paddingHorizontal: 16,
    paddingTop: 12,
    gap: 8,
  },
  emptyContainer: {
    flex: 1,
  },
  logItem: {
    flexDirection: "row",
    gap: 12,
    padding: 14,
    borderRadius: 4,
    borderWidth: 1,
  },
  logIcon: {
    width: 32,
    height: 32,
    borderRadius: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  logContent: {
    flex: 1,
    gap: 3,
  },
  logHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  logDomain: {
    fontSize: 10,
    fontWeight: "700" as const,
    letterSpacing: 2,
  },
  logType: {
    fontSize: 9,
    letterSpacing: 1,
  },
  logNote: {
    fontSize: 12,
    lineHeight: 18,
  },
  logPending: {
    fontSize: 8,
    fontWeight: "700" as const,
    letterSpacing: 2,
    marginLeft: "auto",
  },
  unsaved: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 16,
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderRadius: 4,
  },
  unsavedText: {
    flex: 1,
    fontSize: 11,
    lineHeight: 16,
  },
  unsavedBtn: {
    paddingVertical: 4,
    paddingHorizontal: 6,
  },
  unsavedAction: {
    fontSize: 10,
    fontWeight: "700" as const,
    letterSpacing: 2,
  },
  logTime: {
    fontSize: 10,
    marginTop: 2,
  },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 40,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: "600" as const,
    marginTop: 8,
  },
  emptyText: {
    fontSize: 13,
    textAlign: "center",
    lineHeight: 20,
  },
});
