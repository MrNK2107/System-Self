// Monthly budgets per category, the stated savings target and currency, and recurring income (posted on its day each
// month by the rollover; it counts in the figures but never scores on its own).
import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { AuthField } from "@/components/AuthField";
import { AuthButton, AuthLink, AuthNotice, AuthShell } from "@/components/AuthShell";
import { SettingsCard } from "@/components/SettingsParts";
import { useColors } from "@/hooks/useColors";
import { useFinanceActions, useFinanceQuery } from "@/hooks/useFinance";
import {
  EXPENSE_CATEGORIES,
  budgetDraft,
  budgetItemsFromDraft,
  categoryLabel,
  describeFinanceError,
  money,
  parseAmount,
  parseSavingsTarget,
  type BudgetDraft,
} from "@/lib/finance/finance";
import type { MutationResult } from "@/lib/game/actions";

const SYNC_PENDING = "Queued entries have not reached the System yet. Retry shortly.";

export default function BudgetScreen() {
  const colors = useColors();
  const q = useFinanceQuery();
  const actions = useFinanceActions();
  const f = q.data;
  const [draft, setDraft] = useState<BudgetDraft | null>(null);
  const [target, setTarget] = useState("");
  const [currency, setCurrency] = useState("");
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [day, setDay] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "info" | "error"; message: string } | null>(null);

  // The form starts from the server's figures once; later edits stay the user's until they save.
  useEffect(() => {
    if (!f || draft) return;
    setDraft(budgetDraft(f));
    setTarget(String(Math.round(f.target * 1000) / 10));
    setCurrency(f.currency);
  }, [f, draft]);

  const attempt = async (send: () => Promise<MutationResult<unknown>>, done: string): Promise<boolean> => {
    if (busy) return false;
    setBusy(true);
    setNotice(null);
    try {
      const r = await send();
      setNotice(r.ok ? { tone: "info", message: done } : { tone: "error", message: SYNC_PENDING });
      return r.ok;
    } catch (e) {
      setNotice({ tone: "error", message: describeFinanceError(e) });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const saveBudgets = async () => {
    if (!draft) return;
    const parsed = budgetItemsFromDraft(draft);
    if (!parsed.ok) return setNotice({ tone: "error", message: `Not an amount: ${parsed.invalid.map(categoryLabel).join(", ")}.` });
    await attempt(() => actions.saveBudgets(parsed.items), "Budgets recorded. Spend is measured against them every Sunday.");
  };

  const saveSettings = async () => {
    const savingsTarget = parseSavingsTarget(target);
    const code = currency.trim().toUpperCase();
    if (savingsTarget === null) return setNotice({ tone: "error", message: "The savings target is a percentage from 5 to 90." });
    if (!/^[A-Z]{3}$/.test(code)) return setNotice({ tone: "error", message: "The currency is a three-letter code, like INR or USD." });
    await attempt(() => actions.saveSettings({ savingsTarget, currency: code }), "Target recorded.");
  };

  const addRecurring = async () => {
    const value = parseAmount(amount);
    const dayOfMonth = Number(day);
    if (!label.trim() || value === null || !Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 28) {
      return setNotice({ tone: "error", message: "Name it, give a positive amount and a day from 1 to 28." });
    }
    if (await attempt(() => actions.addRecurring({ label: label.trim(), amount: value, dayOfMonth }), "Recurring income recorded.")) {
      setLabel("");
      setAmount("");
      setDay("");
    }
  };

  const section = (text: string) => <Text style={[s.section, { color: colors.mutedForeground }]}>{text}</Text>;

  return (
    <AuthShell tag="WEALTH" title="Budgets" subtitle="Monthly limits per category. Each category over its limit costs WEALTH at the week's close." back>
      {notice ? <AuthNotice tone={notice.tone} message={notice.message} /> : null}
      {q.isError && !f ? (
        <AuthNotice message={describeFinanceError(q.error)} onRetry={() => void q.refetch()} />
      ) : !f || !draft ? (
        <AuthNotice tone="info" message="Loading." />
      ) : (
        <>
          {section("MONTHLY LIMITS (BLANK = NONE)")}
          {EXPENSE_CATEGORIES.map((c) => (
            <AuthField
              key={c}
              label={`${categoryLabel(c).toUpperCase()} (${f.currency})`}
              value={draft[c]}
              onChangeText={(t) => setDraft({ ...draft, [c]: t })}
              keyboardType="decimal-pad"
            />
          ))}
          <AuthButton label="SAVE BUDGETS" loading={busy} onPress={() => void saveBudgets()} />

          {section("TARGET")}
          <AuthField label="SAVINGS TARGET (%)" value={target} onChangeText={setTarget} keyboardType="decimal-pad" />
          <AuthField label="CURRENCY" value={currency} onChangeText={setCurrency} autoCapitalize="characters" maxLength={3} mono />
          <AuthButton label="SAVE TARGET" loading={busy} onPress={() => void saveSettings()} />

          {section("RECURRING INCOME")}
          {f.recurring.map((r) => (
            <SettingsCard key={r.id}>
              <View style={s.panel}>
                <Text style={[s.line, { color: r.active ? colors.foreground : colors.mutedForeground }]}>
                  {r.label.toUpperCase()} // {money(r.amount, f.currency)} // DAY {r.dayOfMonth}
                  {r.active ? "" : " // PAUSED"}
                </Text>
                <AuthLink
                  label={r.active ? "PAUSE" : "RESUME"}
                  onPress={() => void attempt(() => actions.setRecurringActive(r.id, !r.active), r.active ? "Paused." : "Resumed.")}
                />
              </View>
            </SettingsCard>
          ))}
          <AuthField label="LABEL" value={label} onChangeText={setLabel} autoCapitalize="words" maxLength={40} />
          <AuthField label={`AMOUNT (${f.currency})`} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
          <AuthField label="DAY OF MONTH (1–28)" value={day} onChangeText={setDay} keyboardType="number-pad" maxLength={2} />
          <AuthButton label="ADD RECURRING INCOME" loading={busy} onPress={() => void addRecurring()} />
        </>
      )}
    </AuthShell>
  );
}

const s = StyleSheet.create({
  section: { fontSize: 10, letterSpacing: 2, fontWeight: "800" as const, marginTop: 6 },
  panel: { paddingVertical: 12, gap: 8 },
  line: { fontSize: 11, letterSpacing: 1, fontWeight: "700" as const },
});
