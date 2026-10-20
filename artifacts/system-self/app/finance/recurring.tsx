// Recurring income: posted on its day each month by the rollover. It counts in the month's figures but never scores
// on its own.
import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { Button } from "@/components/ui/Button";
import { ListRow } from "@/components/ui/ListRow";
import { Screen } from "@/components/ui/Screen";
import { space, type } from "@/constants/type";
import { LoadState, StatusLine, useAttempt } from "@/features/finance/components";
import { TextField } from "@/features/gym/components/Fields";
import { useColors } from "@/hooks/useColors";
import { useFinanceActions, useFinanceQuery } from "@/hooks/useFinance";
import { money, parseAmount } from "@/lib/finance/finance";

export default function RecurringScreen() {
  const colors = useColors();
  const q = useFinanceQuery();
  const actions = useFinanceActions();
  const f = q.data;
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [day, setDay] = useState("");
  const { busy, notice, attempt, fail } = useAttempt();

  const add = async () => {
    const value = parseAmount(amount);
    const dayOfMonth = Number(day);
    if (!label.trim() || value === null || !Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 28) {
      return fail("Name it, give a positive amount and a day from 1 to 28.");
    }
    if (await attempt(() => actions.addRecurring({ label: label.trim(), amount: value, dayOfMonth }), "Recurring income recorded.")) {
      setLabel("");
      setAmount("");
      setDay("");
    }
  };

  if (!f) {
    return (
      <Screen title="Recurring income" back>
        <LoadState error={q.isError ? q.error : null} onRetry={() => void q.refetch()} />
      </Screen>
    );
  }

  return (
    <Screen title="Recurring income" back>
      {f.recurring.length === 0 ? (
        <Text style={[type.body, { color: colors.mutedForeground }]}>None set. Salary or rent received, posted on its day each month.</Text>
      ) : (
        <View>
          {f.recurring.map((r) => (
            <ListRow
              key={r.id}
              title={r.label}
              subtitle={`${money(r.amount, f.currency)} · day ${r.dayOfMonth}${r.active ? "" : " · paused"}`}
              dot={r.active ? colors.domain.WEALTH : colors.subtle}
              trailing={
                <Button
                  label={r.active ? "Pause" : "Resume"}
                  variant="text"
                  onPress={() => void attempt(() => actions.setRecurringActive(r.id, !r.active), r.active ? "Paused." : "Resumed.")}
                />
              }
            />
          ))}
        </View>
      )}

      <View style={s.form}>
        <Text style={[type.title, { color: colors.foreground }]}>Add recurring income</Text>
        <TextField label="LABEL" value={label} onChangeText={setLabel} autoCapitalize="words" maxLength={40} placeholder="Salary" />
        <TextField label={`AMOUNT (${f.currency})`} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
        <TextField label="DAY OF MONTH (1–28)" value={day} onChangeText={setDay} keyboardType="number-pad" maxLength={2} />
        <StatusLine notice={notice} />
        <Button label="Add recurring income" block loading={busy} onPress={() => void add()} />
      </View>
    </Screen>
  );
}

const s = StyleSheet.create({ form: { gap: space.md, marginTop: space.sm } });
