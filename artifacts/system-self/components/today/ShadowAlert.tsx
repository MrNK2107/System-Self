// Today's shadow-self card: who is ahead, in which domains, and one action to see the full confrontation.
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/ui/Button";
import { ALL_DOMAINS } from "@/constants/domains";
import { space, type } from "@/constants/type";
import { useApp } from "@/context/AppContext";
import { useColors } from "@/hooks/useColors";

export function ShadowAlert({ onConfront }: { onConfront: () => void }) {
  const colors = useColors();
  const { shadowSelf, domainScores, getShadowScores } = useApp();

  const shadowScores = getShadowScores();
  const losing = ALL_DOMAINS.filter((d) => shadowScores[d] > (domainScores.find((s) => s.domain === d)?.score ?? 0));
  const isLosing = losing.length > 0;
  const gap = Math.abs(shadowSelf.gap).toFixed(1);

  return (
    <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={s.head}>
        <View style={[s.dot, { backgroundColor: isLosing ? colors.destructive : colors.success }]} />
        <Text style={[type.bodyStrong, s.flex, { color: colors.foreground }]}>
          {isLosing ? `${shadowSelf.codename} is ${gap} pts ahead` : `You lead ${shadowSelf.codename} by ${gap} pts`}
        </Text>
      </View>
      <Text style={[type.meta, { color: isLosing ? colors.destructive : colors.mutedForeground }]}>
        {isLosing
          ? `Behind in ${losing.join(", ")}.`
          : "Stay consistent."}
      </Text>
      <Text style={[type.meta, { color: colors.subtle }]}>Your shadow is the self that never skips. It gains every day.</Text>
      <Button label="Confront shadow" variant="text" onPress={onConfront} style={s.action} />
    </View>
  );
}

const s = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 4, padding: space.md, paddingBottom: space.xs, gap: space.xs },
  head: { flexDirection: "row", alignItems: "center", gap: space.sm },
  dot: { width: 8, height: 8, borderRadius: 4 },
  flex: { flex: 1 },
  action: { marginLeft: -space.sm - 4, marginTop: space.xs },
});
