// Financial goals: each with its saved / target bar. Tap one to contribute or edit it.
import React from "react";
import { router } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";

import { Button } from "@/components/ui/Button";
import { Screen } from "@/components/ui/Screen";
import { space, type } from "@/constants/type";
import { Bar, LoadState } from "@/features/finance/components";
import { useColors } from "@/hooks/useColors";
import { useFinanceQuery } from "@/hooks/useFinance";
import { goalProgress, money } from "@/lib/finance/finance";

const STATUS: Record<string, string> = { active: "Active", achieved: "Achieved", abandoned: "Abandoned" };

export default function GoalsScreen() {
  const colors = useColors();
  const q = useFinanceQuery();
  const f = q.data;

  if (!f) {
    return (
      <Screen title="Goals" back>
        <LoadState error={q.isError ? q.error : null} onRetry={() => void q.refetch()} />
      </Screen>
    );
  }

  return (
    <Screen title="Goals" back>
      {f.goals.length === 0 ? (
        <Text style={[type.body, { color: colors.mutedForeground }]}>No goals set. Name one: a number and a date.</Text>
      ) : (
        <View>
          {f.goals.map((g) => (
            <Pressable
              key={g.id}
              onPress={() => router.push({ pathname: "/finance/goal", params: { id: g.id } })}
              accessibilityRole="button"
              accessibilityLabel={`${g.title}, ${money(g.savedAmount, f.currency)} of ${money(g.targetAmount, f.currency)}`}
              android_ripple={{ color: "rgba(168,121,255,0.12)" }}
              style={[s.goal, { borderBottomColor: colors.border }]}
            >
              <View style={s.text}>
                <Text style={[type.body, { color: g.status === "active" ? colors.foreground : colors.mutedForeground }]}>{g.title}</Text>
                <Text style={[type.meta, { color: colors.mutedForeground }]}>
                  {money(g.savedAmount, f.currency)} of {money(g.targetAmount, f.currency)}
                  {g.deadline ? ` · by ${g.deadline}` : ""} · {STATUS[g.status] ?? g.status}
                </Text>
                <Bar fraction={goalProgress(g)} />
              </View>
              <Feather name="chevron-right" size={20} color={colors.subtle} />
            </Pressable>
          ))}
        </View>
      )}
      <Button label="New goal" variant={f.goals.length === 0 ? "filled" : "tonal"} block onPress={() => router.push("/finance/goal")} />
    </Screen>
  );
}

const s = StyleSheet.create({
  goal: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  text: { flex: 1, gap: space.sm },
});
