// The stated savings target (the bar the weekly evaluation measures the savings rate against) and the currency.
import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { Button } from "@/components/ui/Button";
import { Screen } from "@/components/ui/Screen";
import { space, type } from "@/constants/type";
import { LoadState, StatusLine, useAttempt } from "@/features/finance/components";
import { TextField } from "@/features/gym/components/Fields";
import { useColors } from "@/hooks/useColors";
import { useFinanceActions, useFinanceQuery } from "@/hooks/useFinance";
import { parseSavingsTarget } from "@/lib/finance/finance";

export default function TargetScreen() {
  const colors = useColors();
  const q = useFinanceQuery();
  const actions = useFinanceActions();
  const f = q.data;
  const [target, setTarget] = useState<string | null>(null);
  const [currency, setCurrency] = useState("");
  const { busy, notice, attempt, fail } = useAttempt();

  useEffect(() => {
    if (!f || target !== null) return;
    setTarget(String(Math.round(f.target * 1000) / 10));
    setCurrency(f.currency);
  }, [f, target]);

  const save = async () => {
    const savingsTarget = parseSavingsTarget(target ?? "");
    const code = currency.trim().toUpperCase();
    if (savingsTarget === null) return fail("The savings target is a percentage from 5 to 90.");
    if (!/^[A-Z]{3}$/.test(code)) return fail("The currency is a three-letter code, like INR or USD.");
    await attempt(() => actions.saveSettings({ savingsTarget, currency: code }), "Target recorded.");
  };

  return (
    <Screen title="Savings target" back>
      {!f || target === null ? (
        <LoadState error={q.isError ? q.error : null} onRetry={() => void q.refetch()} />
      ) : (
        <View style={s.form}>
          <Text style={[type.body, { color: colors.mutedForeground }]}>
            The share of income you keep. Each Sunday the month's savings rate is measured against it.
          </Text>
          <TextField label="SAVINGS TARGET (%)" value={target} onChangeText={setTarget} keyboardType="decimal-pad" />
          <TextField label="CURRENCY" value={currency} onChangeText={setCurrency} autoCapitalize="characters" maxLength={3} placeholder="INR" />
          <StatusLine notice={notice} />
          <Button label="Save target" block loading={busy} onPress={() => void save()} />
        </View>
      )}
    </Screen>
  );
}

const s = StyleSheet.create({ form: { gap: space.md } });
