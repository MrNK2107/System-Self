import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import type { RivalTaunt } from "@workspace/contracts";

interface Props {
  taunt: RivalTaunt;
}

export function RivalTauntCard({ taunt }: Props) {
  const colors = useColors();
  const timeAgo = getTimeAgo(taunt.createdAt);
  const shortName = taunt.codename.split(" // ")[1] ?? taunt.codename;

  return (
    <View style={[
      styles.card,
      {
        borderColor: taunt.read ? colors.border : "#E0555530",
        backgroundColor: taunt.read ? colors.card : "#E0555506",
      },
    ]}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          {!taunt.read && <View style={styles.unreadDot} />}
          <Feather name="message-circle" size={11} color="#E05555" />
          <Text style={[styles.rivalName, { color: "#E05555" }]}>{shortName}</Text>
          {taunt.isGhost ? (
            <Text style={[styles.simTag, { color: colors.mutedForeground, borderColor: colors.border }]} accessibilityLabel="Simulated rival">
              SIM
            </Text>
          ) : null}
          <Text style={[styles.tauntLabel, { color: colors.mutedForeground }]}>TRANSMISSION</Text>
        </View>
        <Text style={[styles.timeAgo, { color: colors.mutedForeground }]}>{timeAgo}</Text>
      </View>
      <Text style={[styles.message, { color: taunt.read ? colors.mutedForeground : colors.foreground }]}>
        "{taunt.message}"
      </Text>
    </View>
  );
}

function getTimeAgo(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 6, padding: 12, gap: 8 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 7 },
  unreadDot: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: "#E05555" },
  rivalName: { fontSize: 10, fontWeight: "800" as const, letterSpacing: 1.5 },
  simTag: { fontSize: 7, fontWeight: "800" as const, letterSpacing: 1.5, borderWidth: 1, borderRadius: 2, paddingHorizontal: 4, paddingVertical: 1 },
  tauntLabel: { fontSize: 8, letterSpacing: 2, fontWeight: "600" as const },
  timeAgo: { fontSize: 9, letterSpacing: 0.5 },
  message: { fontSize: 12, lineHeight: 18, fontStyle: "italic" },
});
