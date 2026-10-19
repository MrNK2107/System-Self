// Finance (PRD 19): the month's savings rate against the stated target, spend per category against its budget, goals
// with contributions, and the net worth record. Private: none of this is ever shown to another player.
import React, { useState } from "react";
import { router } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import type { FinancialGoal } from "@workspace/contracts";
import { AuthField } from "@/components/AuthField";
import { AuthButton, AuthLink, AuthNotice, AuthShell } from "@/components/AuthShell";
import { SettingsCard } from "@/components/SettingsParts";
import { useColors } from "@/hooks/useColors";
import { useFinanceActions, useFinanceQuery } from "@/hooks/useFinance";
import {
  budgetBar,
  categoryLabel,
  describeFinanceError,
  goalProgress,
  money,
  netWorthRows,
  parseAmount,
  parseSignedAmount,
  percent,
  savingsVerdict,
} from "@/lib/finance/finance";
import type { MutationResult } from "@/lib/game/actions";

const SYNC_PENDING = "Queued entries have not reached the System yet. Retry shortly.";

function Bar({ fraction, color }: { fraction: number; color: string }) {
  const colors = useColors();
  return (
    <View style={[s.track, { backgroundColor: colors.border }]}>
      <View style={[s.fill, { width: `${Math.round(fraction * 100)}%`, backgroundColor: color }]} />
    </View>
  );
}

function GoalCard({ goal, currency, busy, onContribute }: { goal: FinancialGoal; currency: string; busy: boolean; onContribute: (amount: number) => Promise<boolean> }) {
  const colors = useColors();
  const [text, setText] = useState("");
  const [invalid, setInvalid] = useState(false);
  const submit = async () => {
    const amount = parseAmount(text);
    if (amount === null) return setInvalid(true);
    setInvalid(false);
    if (await onContribute(amount)) setText("");
  };
  return (
    <SettingsCard>
      <View style={s.panel}>
        <Text style={[s.title, { color: colors.foreground }]}>{goal.title}</Text>
        <Text style={[s.hint, { color: colors.mutedForeground }]}>
          {money(goal.savedAmount, currency)} OF {money(goal.targetAmount, currency)}
          {goal.deadline ? ` // BY ${goal.deadline}` : ""} // {goal.status.toUpperCase()}
        </Text>
        <Bar fraction={goalProgress(goal)} color={colors.domain.WEALTH} />
        {goal.status === "active" ? (
          <>
            <AuthField label="CONTRIBUTE" value={text} onChangeText={setText} keyboardType="decimal-pad" error={invalid ? "Enter a positive amount." : null} />
            <AuthButton label="ADD TO GOAL" loading={busy} onPress={() => void submit()} />
          </>
        ) : null}
        <AuthLink label="EDIT" onPress={() => router.push({ pathname: "/finance/goal", params: { id: goal.id } })} />
      </View>
    </SettingsCard>
  );
}

export default function FinanceScreen() {
  const colors = useColors();
  const q = useFinanceQuery();
  const actions = useFinanceActions();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [netWorth, setNetWorth] = useState("");

  const attempt = async (send: () => Promise<MutationResult<unknown>>): Promise<boolean> => {
    if (busy) return false;
    setBusy(true);
    setError(null);
    try {
      const r = await send();
      if (!r.ok) setError(SYNC_PENDING);
      return r.ok;
    } catch (e) {
      setError(describeFinanceError(e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const f = q.data;
  const label = (text: string) => <Text style={[s.section, { color: colors.mutedForeground }]}>{text}</Text>;
  const verdict = f ? savingsVerdict(f.savingsRate, f.target) : null;
  const toneColor = verdict?.tone === "good" ? colors.domain.WEALTH : verdict?.tone === "bad" ? colors.destructive : colors.foreground;

  const saveNetWorth = async () => {
    const amount = parseSignedAmount(netWorth);
    if (amount === null || !f) return setError("Enter your net worth as a number. Negative is allowed.");
    if (await attempt(() => actions.setNetWorth(f.month, amount))) setNetWorth("");
  };

  return (
    <AuthShell tag="WEALTH" title="Finance" subtitle="THE SYSTEM does not advise. It keeps the record and delivers the verdict every Sunday." back>
      {error ? <AuthNotice message={error} /> : null}
      {q.isError && !f ? (
        <AuthNotice message={describeFinanceError(q.error)} onRetry={() => void q.refetch()} />
      ) : !f ? (
        <AuthNotice tone="info" message="Loading." />
      ) : (
        <>
          {label(`SAVINGS RATE // ${f.month}`)}
          <SettingsCard>
            <View style={s.panel}>
              <Text style={[s.big, { color: toneColor }]}>{percent(f.savingsRate)}</Text>
              <Text style={[s.hint, { color: colors.mutedForeground }]}>{verdict!.line}</Text>
              <Text style={[s.line, { color: colors.foreground }]}>
                IN {money(f.income, f.currency)} // OUT {money(f.expenses, f.currency)}
              </Text>
            </View>
          </SettingsCard>

          {label("SPEND BY CATEGORY")}
          <SettingsCard>
            <View style={s.panel}>
              {f.byCategory.map((c) => {
                const bar = budgetBar(c.spent, c.limit);
                if (!bar && c.spent === 0) return null;
                return (
                  <View key={c.category} style={s.category}>
                    <Text style={[s.line, { color: bar?.over ? colors.destructive : colors.foreground }]}>
                      {categoryLabel(c.category).toUpperCase()} // {money(c.spent, f.currency)}
                      {c.limit !== null ? ` OF ${money(c.limit, f.currency)}` : ""}
                      {bar?.over ? " // OVER" : ""}
                    </Text>
                    {bar ? <Bar fraction={bar.fraction} color={bar.over ? colors.destructive : colors.domain.WEALTH} /> : null}
                  </View>
                );
              })}
              {f.byCategory.every((c) => c.limit === null && c.spent === 0) ? (
                <Text style={[s.hint, { color: colors.mutedForeground }]}>No spend and no budgets this month.</Text>
              ) : null}
            </View>
          </SettingsCard>
          <AuthLink label="BUDGETS, TARGET AND RECURRING INCOME" onPress={() => router.push("/finance/budget")} />

          {label("GOALS")}
          {f.goals.length === 0 ? <Text style={[s.hint, { color: colors.mutedForeground }]}>No goals set. Name one.</Text> : null}
          {f.goals.map((g) => (
            <GoalCard key={g.id} goal={g} currency={f.currency} busy={busy} onContribute={(amount) => attempt(() => actions.contribute(g.id, amount))} />
          ))}
          <AuthLink label="NEW GOAL" onPress={() => router.push("/finance/goal")} />

          {label("NET WORTH // LAST 12 MONTHS")}
          <SettingsCard>
            <View style={s.panel}>
              {netWorthRows(f.netWorth).map((p) => (
                <Text key={p.month} style={[s.line, { color: colors.foreground }]}>
                  {p.month} // {money(p.amount, f.currency)}
                  {p.change !== null ? ` (${p.change >= 0 ? "+" : ""}${money(p.change, f.currency)})` : ""}
                </Text>
              ))}
              {f.netWorth.length === 0 ? <Text style={[s.hint, { color: colors.mutedForeground }]}>No snapshots yet. Record one a month.</Text> : null}
              <AuthField label={`NET WORTH FOR ${f.month}`} value={netWorth} onChangeText={setNetWorth} keyboardType="numbers-and-punctuation" />
              <AuthButton label="RECORD" loading={busy} onPress={() => void saveNetWorth()} />
            </View>
          </SettingsCard>
        </>
      )}
    </AuthShell>
  );
}

const s = StyleSheet.create({
  section: { fontSize: 10, letterSpacing: 2, fontWeight: "800" as const, marginTop: 6 },
  panel: { paddingVertical: 14, gap: 10 },
  title: { fontSize: 14, fontWeight: "700" as const, letterSpacing: 0.5 },
  big: { fontSize: 32, fontWeight: "800" as const, letterSpacing: 1 },
  line: { fontSize: 11, letterSpacing: 1, fontWeight: "700" as const },
  hint: { fontSize: 10, letterSpacing: 1.5, fontWeight: "600" as const },
  category: { gap: 6 },
  track: { height: 4, borderRadius: 2, overflow: "hidden" },
  fill: { height: 4, borderRadius: 2 },
});
