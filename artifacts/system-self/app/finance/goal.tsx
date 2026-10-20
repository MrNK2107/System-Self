// A financial goal (PRD 19: "Save ₹50,000 by March"): new, or with ?id= contributed to, edited, abandoned or reopened.
// A goal is achieved by contributions once the saved amount reaches the target; a contribution also scores (a WEALTH
// saving log on the server).
import React, { useEffect, useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { StyleSheet, Text, View } from "react-native";

import { Button } from "@/components/ui/Button";
import { Screen } from "@/components/ui/Screen";
import { SystemWindow } from "@/components/ui/SystemWindow";
import { space, type } from "@/constants/type";
import { Bar, LoadState, StatusLine, useAttempt } from "@/features/finance/components";
import { TextField } from "@/features/gym/components/Fields";
import { useColors } from "@/hooks/useColors";
import { useFinanceActions, useFinanceQuery } from "@/hooks/useFinance";
import { goalProgress, money, parseAmount, parseDeadline } from "@/lib/finance/finance";

export default function GoalScreen() {
  const colors = useColors();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const q = useFinanceQuery();
  const actions = useFinanceActions();
  const goal = id ? q.data?.goals.find((g) => g.id === id) : undefined;
  const currency = q.data?.currency ?? "";
  const [title, setTitle] = useState("");
  const [target, setTarget] = useState("");
  const [deadline, setDeadline] = useState("");
  const [contribution, setContribution] = useState("");
  const [loaded, setLoaded] = useState(false);
  const edit = useAttempt();
  const give = useAttempt();

  useEffect(() => {
    if (!goal || loaded) return;
    setTitle(goal.title);
    setTarget(String(goal.targetAmount));
    setDeadline(goal.deadline ?? "");
    setLoaded(true);
  }, [goal, loaded]);

  const leaveOn = async (send: Parameters<typeof edit.attempt>[0]) => {
    if (await edit.attempt(send)) router.back();
  };

  const save = () => {
    const targetAmount = parseAmount(target);
    const due = parseDeadline(deadline);
    if (!title.trim() || title.trim().length > 80) return edit.fail("Name the goal in 1 to 80 characters.");
    if (targetAmount === null) return edit.fail("The target is a positive amount.");
    if (due === undefined) return edit.fail("The deadline is a date as YYYY-MM-DD, or blank.");
    const fields = { title: title.trim(), targetAmount, deadline: due };
    void leaveOn(() => (goal ? actions.updateGoal(goal.id, fields) : actions.createGoal(fields)));
  };

  const contribute = async () => {
    if (!goal) return;
    const amount = parseAmount(contribution);
    if (amount === null) return give.fail("Enter a positive amount.");
    if (await give.attempt(() => actions.contribute(goal.id, amount), "Contribution recorded.")) setContribution("");
  };

  if (id && !goal) {
    return (
      <Screen title="Goal" back>
        {q.data ? (
          <Text style={[type.body, { color: colors.mutedForeground }]}>Goal not found. It may have been removed.</Text>
        ) : (
          <LoadState error={q.isError ? q.error : null} onRetry={() => void q.refetch()} />
        )}
      </Screen>
    );
  }

  return (
    <Screen title={goal ? goal.title : "New goal"} back>
      {goal ? (
        <View style={s.group}>
          <Text style={[type.display, { color: colors.foreground }]}>{Math.round(goalProgress(goal) * 100)}%</Text>
          <Bar fraction={goalProgress(goal)} />
          <Text style={[type.body, { color: colors.mutedForeground }]}>
            {money(goal.savedAmount, currency)} of {money(goal.targetAmount, currency)}
            {goal.deadline ? ` by ${goal.deadline}` : ""}
          </Text>
        </View>
      ) : (
        <Text style={[type.body, { color: colors.mutedForeground }]}>A number and a date. Contributions are logged as savings. THE SYSTEM tracks the gap.</Text>
      )}

      {goal?.status === "achieved" ? (
        <SystemWindow title="GOAL ACHIEVED" frameColor={colors.domain.WEALTH}>
          <Text style={[type.body, { color: colors.foreground }]}>It stays on the record.</Text>
        </SystemWindow>
      ) : null}

      {goal?.status === "active" ? (
        <View style={s.group}>
          <TextField label={`CONTRIBUTE${currency ? ` (${currency})` : ""}`} value={contribution} onChangeText={setContribution} keyboardType="decimal-pad" />
          <StatusLine notice={give.notice} />
          <Button label="Add to goal" block loading={give.busy} onPress={() => void contribute()} />
        </View>
      ) : null}

      {goal?.status !== "achieved" ? (
        <View style={s.group}>
          {goal ? <Text style={[type.title, { color: colors.foreground }]}>Edit goal</Text> : null}
          <TextField label="GOAL" value={title} onChangeText={setTitle} placeholder="Emergency fund" autoCapitalize="sentences" maxLength={80} />
          <TextField label={`TARGET${currency ? ` (${currency})` : ""}`} value={target} onChangeText={setTarget} keyboardType="decimal-pad" />
          <TextField label="DEADLINE (OPTIONAL)" value={deadline} onChangeText={setDeadline} placeholder="YYYY-MM-DD" keyboardType="numbers-and-punctuation" />
          <StatusLine notice={edit.notice} />
          <Button label={goal ? "Save goal" : "Set goal"} variant={goal ? "tonal" : "filled"} block loading={edit.busy} onPress={save} />
        </View>
      ) : null}

      {goal?.status === "active" ? (
        <Button label="Abandon goal" variant="text" onPress={() => void leaveOn(() => actions.updateGoal(goal.id, { status: "abandoned" }))} />
      ) : null}
      {goal?.status === "abandoned" ? (
        <Button label="Reopen goal" variant="text" onPress={() => void leaveOn(() => actions.updateGoal(goal.id, { status: "active" }))} />
      ) : null}
    </Screen>
  );
}

const s = StyleSheet.create({ group: { gap: space.md } });
