// Budgets: this month's spend per category against its monthly limit (Spend), and the limits themselves (Limits).
// Each category over its limit costs WEALTH at the week's close.
import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { Button } from "@/components/ui/Button";
import { Screen } from "@/components/ui/Screen";
import { Segmented } from "@/components/ui/Segmented";
import { space, type } from "@/constants/type";
import { Bar, LoadState, StatusLine, useAttempt } from "@/features/finance/components";
import { TextField } from "@/features/gym/components/Fields";
import { useColors } from "@/hooks/useColors";
import { useFinanceActions, useFinanceQuery } from "@/hooks/useFinance";
import {
  EXPENSE_CATEGORIES,
  budgetBar,
  budgetDraft,
  budgetItemsFromDraft,
  categoryLabel,
  money,
  type BudgetDraft,
} from "@/lib/finance/finance";

type Tab = "spend" | "limits";

export default function BudgetScreen() {
  const colors = useColors();
  const q = useFinanceQuery();
  const actions = useFinanceActions();
  const f = q.data;
  const [tab, setTab] = useState<Tab>("spend");
  const [draft, setDraft] = useState<BudgetDraft | null>(null);
  const { busy, notice, attempt, fail } = useAttempt();

  // The form starts from the server's figures once; later edits stay the user's until they save.
  useEffect(() => {
    if (!f || draft) return;
    setDraft(budgetDraft(f));
  }, [f, draft]);

  const saveBudgets = async () => {
    if (!draft) return;
    const parsed = budgetItemsFromDraft(draft);
    if (!parsed.ok) return fail(`Not an amount: ${parsed.invalid.map(categoryLabel).join(", ")}.`);
    await attempt(() => actions.saveBudgets(parsed.items), "Budgets recorded. Spend is measured against them every Sunday.");
  };

  if (!f || !draft) {
    return (
      <Screen title="Budgets" back>
        <LoadState error={q.isError ? q.error : null} onRetry={() => void q.refetch()} />
      </Screen>
    );
  }

  const shown = f.byCategory.filter((c) => c.limit !== null || c.spent > 0);

  return (
    <Screen title="Budgets" back>
      <Segmented<Tab>
        options={[
          { key: "spend", label: "Spend" },
          { key: "limits", label: "Limits" },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === "spend" ? (
        shown.length === 0 ? (
          <View style={s.empty}>
            <Text style={[type.body, { color: colors.mutedForeground }]}>No spend and no limits this month.</Text>
            <Button label="Set limits" variant="tonal" onPress={() => setTab("limits")} />
          </View>
        ) : (
          <View>
            {shown.map((c) => {
              const bar = budgetBar(c.spent, c.limit);
              const over = bar?.over ?? false;
              return (
                <View key={c.category} style={[s.category, { borderBottomColor: colors.border }]}>
                  <View style={s.categoryHead}>
                    <Text style={[type.body, s.flex, { color: colors.foreground }]}>{categoryLabel(c.category)}</Text>
                    <Text style={[type.number, { color: over ? colors.destructive : colors.foreground }]}>{money(c.spent, f.currency)}</Text>
                  </View>
                  {bar ? <Bar fraction={bar.fraction} over={over} /> : null}
                  <Text style={[type.meta, { color: over ? colors.destructive : colors.mutedForeground }]}>
                    {c.limit === null
                      ? "No limit"
                      : over
                        ? `${money(c.spent - c.limit, f.currency)} over a ${money(c.limit, f.currency)} limit`
                        : `${money(c.limit - c.spent, f.currency)} left of ${money(c.limit, f.currency)}`}
                  </Text>
                </View>
              );
            })}
          </View>
        )
      ) : (
        <View style={s.form}>
          <Text style={[type.body, { color: colors.mutedForeground }]}>Monthly limit per category in {f.currency}. Blank means no limit.</Text>
          {EXPENSE_CATEGORIES.map((c) => (
            <TextField
              key={c}
              label={categoryLabel(c).toUpperCase()}
              value={draft[c]}
              onChangeText={(t) => setDraft({ ...draft, [c]: t })}
              keyboardType="decimal-pad"
              placeholder="No limit"
            />
          ))}
          <StatusLine notice={notice} />
          <Button label="Save budgets" block loading={busy} onPress={() => void saveBudgets()} />
        </View>
      )}
      {tab === "spend" ? <StatusLine notice={notice} /> : null}
    </Screen>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1 },
  empty: { gap: space.md },
  category: { paddingVertical: space.md, gap: space.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  categoryHead: { flexDirection: "row", alignItems: "center", gap: space.md },
  form: { gap: space.md },
});
