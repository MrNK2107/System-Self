// Finance from the server. Every mutation is a plain request sent after the outbox; each refetches the summary. A goal
// contribution also scores (a WEALTH saving log on the server), so it refetches the game views too.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import type { ExpenseCategoryValue } from "@workspace/contracts";
import { useGameUserId } from "@/hooks/useGameState";
import { api } from "@/lib/api/client";
import { getOutbox } from "@/lib/api/outbox";
import {
  contributeToGoal,
  createGoal,
  createRecurring,
  fetchFinanceSummary,
  putBudgets,
  putNetWorth,
  setRecurringActive,
  updateFinanceSettings,
  updateGoal,
} from "@/lib/finance/finance";
import { financeKey } from "@/lib/finance/keys";
import { newClientId, type MutationResult } from "@/lib/game/actions";
import { invalidateGame } from "@/lib/game/keys";

export function useFinanceQuery() {
  const userId = useGameUserId();
  return useQuery({ queryKey: financeKey(userId), queryFn: () => fetchFinanceSummary(api), enabled: !!userId });
}

export function useFinanceActions() {
  const queryClient = useQueryClient();
  const userId = useGameUserId();
  const outbox = getOutbox();
  const run = useCallback(
    async <T>(prefix: string, send: (clientId: string) => Promise<MutationResult<T>>, scores = false): Promise<MutationResult<T>> => {
      try {
        return await send(newClientId(prefix));
      } finally {
        await queryClient.invalidateQueries({ queryKey: financeKey(userId) });
        if (scores) await invalidateGame(queryClient, userId, { activity: true });
      }
    },
    [queryClient, userId],
  );
  return {
    saveBudgets: (items: { category: ExpenseCategoryValue; monthlyLimit: number }[]) => run("fin-budgets", (id) => putBudgets(api, outbox, items, id)),
    saveSettings: (settings: { currency?: string; savingsTarget?: number }) => run("fin-settings", (id) => updateFinanceSettings(api, outbox, settings, id)),
    createGoal: (goal: { title: string; targetAmount: number; deadline: string | null }) => run("fin-goal", (id) => createGoal(api, outbox, goal, id)),
    updateGoal: (goalId: string, patch: Parameters<typeof updateGoal>[3]) => run("fin-goal-edit", (id) => updateGoal(api, outbox, goalId, patch, id), true),
    contribute: (goalId: string, amount: number) => run("fin-contribute", (id) => contributeToGoal(api, outbox, goalId, amount, id), true),
    setNetWorth: (month: string, amount: number) => run("fin-networth", (id) => putNetWorth(api, outbox, month, amount, id)),
    addRecurring: (item: { label: string; amount: number; dayOfMonth: number }) => run("fin-recurring", (id) => createRecurring(api, outbox, item, id)),
    setRecurringActive: (recurringId: string, active: boolean) => run("fin-recurring-edit", (id) => setRecurringActive(api, outbox, recurringId, active, id)),
  };
}
