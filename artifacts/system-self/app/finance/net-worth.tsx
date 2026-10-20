// Net worth: one snapshot a month, the last 12 shown newest first with the change from the month before.
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
import { money, netWorthRows, parseSignedAmount } from "@/lib/finance/finance";

export default function NetWorthScreen() {
  const colors = useColors();
  const q = useFinanceQuery();
  const actions = useFinanceActions();
  const f = q.data;
  const [text, setText] = useState("");
  const { busy, notice, attempt, fail } = useAttempt();

  if (!f) {
    return (
      <Screen title="Net worth" back>
        <LoadState error={q.isError ? q.error : null} onRetry={() => void q.refetch()} />
      </Screen>
    );
  }

  const save = async () => {
    const amount = parseSignedAmount(text);
    if (amount === null) return fail("Enter your net worth as a number. Negative is allowed.");
    if (await attempt(() => actions.setNetWorth(f.month, amount), "Snapshot recorded.")) setText("");
  };

  const rows = netWorthRows(f.netWorth);

  return (
    <Screen title="Net worth" back>
      <View style={s.form}>
        <TextField label={`NET WORTH FOR ${f.month}`} value={text} onChangeText={setText} keyboardType="numbers-and-punctuation" placeholder={f.currency} />
        <StatusLine notice={notice} />
        <Button label="Record" block loading={busy} onPress={() => void save()} />
      </View>

      {rows.length === 0 ? (
        <Text style={[type.body, { color: colors.mutedForeground }]}>No snapshots yet. Record one a month.</Text>
      ) : (
        <View>
          {rows.map((p) => (
            <ListRow
              key={p.month}
              title={p.month}
              subtitle={p.change !== null ? `${p.change >= 0 ? "+" : ""}${money(p.change, f.currency)} from the month before` : "First snapshot"}
              trailing={<Text style={[type.number, { color: colors.foreground }]}>{money(p.amount, f.currency)}</Text>}
            />
          ))}
        </View>
      )}
    </Screen>
  );
}

const s = StyleSheet.create({ form: { gap: space.md } });
