import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import type { PublicProfile } from "@workspace/contracts";
import { RankBadge } from "@/components/RankBadge";
import { useColors } from "@/hooks/useColors";
import { profileSummary } from "@/lib/social/social";

/** One player as the server projected them: handle (username or codename), rank, trajectory. */
export function PlayerRow({ player, onPress }: { player: PublicProfile; onPress: () => void }) {
  const colors = useColors();
  const sum = profileSummary(player);
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.75}
      accessibilityRole="button"
      accessibilityLabel={`${player.handle}, ${sum.rankLine}, ${sum.trajectoryLine}`}
      style={[s.row, { borderColor: colors.border, backgroundColor: colors.card }]}
    >
      <RankBadge rank={player.rank} size="sm" />
      <View style={s.body}>
        <Text style={[s.handle, { color: colors.foreground }]} numberOfLines={1}>
          {player.handle}
        </Text>
        <Text style={[s.meta, { color: colors.mutedForeground }]}>
          {sum.trajectoryLine}
          {sum.shadowLine ? `  ·  ${sum.shadowLine}` : ""}
        </Text>
      </View>
      <Feather name="chevron-right" size={14} color={colors.mutedForeground} />
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderRadius: 4, padding: 12 },
  body: { flex: 1, gap: 3 },
  handle: { fontSize: 14, fontWeight: "700" as const, letterSpacing: 0.5 },
  meta: { fontSize: 10, letterSpacing: 1.5, fontWeight: "600" as const },
});
