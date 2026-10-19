// A financial goal (PRD 19: "Save ₹50,000 by March"): new, or with ?id= edited, abandoned or reopened. A goal is
// achieved by contributions (from the finance screen) once the saved amount reaches the target.
import React, { useEffect, useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { AuthField } from "@/components/AuthField";
import { AuthButton, AuthLink, AuthNotice, AuthShell } from "@/components/AuthShell";
import { useFinanceActions, useFinanceQuery } from "@/hooks/useFinance";
import { describeFinanceError, parseAmount, parseDeadline } from "@/lib/finance/finance";
import type { MutationResult } from "@/lib/game/actions";

const SYNC_PENDING = "Queued entries have not reached the System yet. Retry shortly.";

export default function GoalScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const q = useFinanceQuery();
  const actions = useFinanceActions();
  const goal = id ? q.data?.goals.find((g) => g.id === id) : undefined;
  const currency = q.data?.currency ?? "";
  const [title, setTitle] = useState("");
  const [target, setTarget] = useState("");
  const [deadline, setDeadline] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!goal || loaded) return;
    setTitle(goal.title);
    setTarget(String(goal.targetAmount));
    setDeadline(goal.deadline ?? "");
    setLoaded(true);
  }, [goal, loaded]);

  const attempt = async (send: () => Promise<MutationResult<unknown>>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await send();
      if (!r.ok) setError(SYNC_PENDING);
      else router.back();
    } catch (e) {
      setError(describeFinanceError(e));
    } finally {
      setBusy(false);
    }
  };

  const save = () => {
    const targetAmount = parseAmount(target);
    const due = parseDeadline(deadline);
    if (!title.trim() || title.trim().length > 80) return setError("Name the goal in 1 to 80 characters.");
    if (targetAmount === null) return setError("The target is a positive amount.");
    if (due === undefined) return setError("The deadline is a date as YYYY-MM-DD, or blank.");
    const fields = { title: title.trim(), targetAmount, deadline: due };
    void attempt(() => (goal ? actions.updateGoal(goal.id, fields) : actions.createGoal(fields)));
  };

  if (id && !goal) {
    return (
      <AuthShell tag="WEALTH" title="Goal" back>
        {q.isError ? <AuthNotice message={describeFinanceError(q.error)} onRetry={() => void q.refetch()} /> : <AuthNotice tone="info" message={q.data ? "Goal not found." : "Loading."} />}
      </AuthShell>
    );
  }

  return (
    <AuthShell
      tag="WEALTH"
      title={goal ? "Edit goal" : "New goal"}
      subtitle="A number and a date. Contributions are logged as savings. THE SYSTEM tracks the gap."
      back
    >
      {error ? <AuthNotice message={error} /> : null}
      <AuthField label="GOAL" value={title} onChangeText={setTitle} placeholder="Emergency fund" autoCapitalize="sentences" maxLength={80} />
      <AuthField label={`TARGET${currency ? ` (${currency})` : ""}`} value={target} onChangeText={setTarget} keyboardType="decimal-pad" />
      <AuthField label="DEADLINE (OPTIONAL)" value={deadline} onChangeText={setDeadline} placeholder="YYYY-MM-DD" keyboardType="numbers-and-punctuation" mono />
      {goal?.status !== "achieved" ? <AuthButton label={goal ? "SAVE GOAL" : "SET GOAL"} loading={busy} onPress={save} /> : null}
      {goal?.status === "active" ? <AuthLink label="ABANDON GOAL" onPress={() => void attempt(() => actions.updateGoal(goal.id, { status: "abandoned" }))} /> : null}
      {goal?.status === "abandoned" ? <AuthLink label="REOPEN GOAL" onPress={() => void attempt(() => actions.updateGoal(goal.id, { status: "active" }))} /> : null}
      {goal?.status === "achieved" ? <AuthNotice tone="info" message="Achieved. It stays on the record." /> : null}
    </AuthShell>
  );
}
