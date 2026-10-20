// Finance (PRD 19), reached from Status -> WEALTH. One job: is my money on track. The month's savings rate is the hero
// figure, and only once income is logged (no verdict without data). Budgets, goals, net worth, recurring income and the
// savings target each sit behind a row. Private: none of this is ever shown to another player.
import React, { useState } from "react";
import { router } from "expo-router";
import { StyleSheet, Text, View } from "react-native";

import { LogModal } from "@/components/LogModal";
import { Button } from "@/components/ui/Button";
import { ListRow } from "@/components/ui/ListRow";
import { Screen } from "@/components/ui/Screen";
import { SystemWindow } from "@/components/ui/SystemWindow";
import { space, type } from "@/constants/type";
import { LoadState } from "@/features/finance/components";
import { useColors } from "@/hooks/useColors";
import { useFinanceQuery } from "@/hooks/useFinance";
import { budgetOverview, categoryLabel, money, netWorthRows, percent, savingsStatus } from "@/lib/finance/finance";

export default function FinanceScreen() {
  const colors = useColors();
  const q = useFinanceQuery();
  const [logOpen, setLogOpen] = useState(false);
  const f = q.data;

  const closeLog = () => {
    setLogOpen(false);
    void q.refetch();
  };

  if (!f) {
    return (
      <Screen title="Finance" back>
        <LoadState error={q.isError ? q.error : null} onRetry={() => void q.refetch()} />
      </Screen>
    );
  }

  const status = savingsStatus(f);
  const wealth = colors.domain.WEALTH;
  const toneColor = status.kind === "rated" ? (status.tone === "good" ? wealth : status.tone === "warn" ? colors.warn : colors.destructive) : colors.foreground;
  const budgets = budgetOverview(f.byCategory);
  const activeGoals = f.goals.filter((g) => g.status === "active");
  const latestNet = netWorthRows(f.netWorth)[0];
  const activeRecurring = f.recurring.filter((r) => r.active);
  const recurringTotal = activeRecurring.reduce((sum, r) => sum + r.amount, 0);

  const budgetsSubtitle =
    budgets.over.length > 0
      ? `Over: ${budgets.over.map((o) => `${categoryLabel(o.category)} by ${money(o.by, f.currency)}`).join(", ")}`
      : budgets.limited > 0
        ? `${budgets.limited} ${budgets.limited === 1 ? "limit" : "limits"} set · all within`
        : "No limits set";

  return (
    <Screen title="Finance" back refreshing={q.isRefetching} onRefresh={() => void q.refetch()}>
      {status.kind === "empty" ? (
        <SystemWindow>
          <Text style={[type.title, { color: colors.foreground }]}>No money logged this month.</Text>
          <Text style={[type.body, { color: colors.mutedForeground }]}>Log income and spending. THE SYSTEM measures the savings rate from them.</Text>
          <View style={s.actions}>
            <Button label="Add income" onPress={() => setLogOpen(true)} />
            <Button label="Log an expense" variant="tonal" onPress={() => setLogOpen(true)} />
          </View>
        </SystemWindow>
      ) : (
        <View style={s.hero}>
          {status.kind === "rated" ? (
            <>
              <Text style={[type.display, { color: toneColor }]} accessibilityLabel={`Savings rate ${percent(f.savingsRate)}`}>
                {percent(f.savingsRate)}
              </Text>
              <Text style={[type.body, { color: colors.mutedForeground }]}>{status.line}</Text>
            </>
          ) : (
            <SystemWindow>
              <Text style={[type.title, { color: colors.foreground }]}>{status.line}</Text>
              <Button label="Add income" onPress={() => setLogOpen(true)} />
            </SystemWindow>
          )}
          <View style={s.inOut}>
            <Figure label="IN" value={money(f.income, f.currency)} />
            <Figure label="OUT" value={money(f.expenses, f.currency)} />
          </View>
          <Text style={[type.meta, { color: colors.subtle }]}>{f.month} · THE SYSTEM delivers the verdict every Sunday.</Text>
          <Button label="Log income or expense" variant="tonal" block onPress={() => setLogOpen(true)} />
        </View>
      )}

      <View>
        <ListRow
          title="Budgets"
          subtitle={budgetsSubtitle}
          dot={budgets.over.length > 0 ? colors.destructive : wealth}
          chevron
          onPress={() => router.push("/finance/budget")}
        />
        <ListRow
          title="Goals"
          subtitle={activeGoals.length ? `${activeGoals.length} active` : f.goals.length ? "None active" : "No goals set"}
          dot={wealth}
          chevron
          onPress={() => router.push("/finance/goals")}
        />
        <ListRow
          title="Net worth"
          subtitle={latestNet ? `${latestNet.month}: ${money(latestNet.amount, f.currency)}` : "No snapshots yet"}
          dot={wealth}
          chevron
          onPress={() => router.push("/finance/net-worth")}
        />
        <ListRow
          title="Recurring income"
          subtitle={activeRecurring.length ? `${activeRecurring.length} active · ${money(recurringTotal, f.currency)} a month` : "None set"}
          dot={wealth}
          chevron
          onPress={() => router.push("/finance/recurring")}
        />
        <ListRow
          title="Savings target"
          subtitle={`${percent(f.target)} of income · ${f.currency}`}
          dot={wealth}
          chevron
          onPress={() => router.push("/finance/target")}
        />
      </View>
      <LogModal visible={logOpen} onClose={closeLog} />
    </Screen>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  const colors = useColors();
  return (
    <View style={s.figure}>
      <Text style={[type.label, { color: colors.mutedForeground }]}>{label}</Text>
      <Text style={[type.number, { color: colors.foreground }]}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  hero: { gap: space.md },
  inOut: { flexDirection: "row", gap: space.lg },
  figure: { flex: 1, gap: space.xs },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: space.sm, marginTop: space.sm },
});
