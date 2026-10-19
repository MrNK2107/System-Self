// PRO as the server reports it (GET /api/billing/status). Unknown (loading, offline, signed out) counts as free.
import { useQuery } from "@tanstack/react-query";
import { useGameUserId } from "@/hooks/useGameState";
import { api } from "@/lib/api/client";
import { billingStatusKey, fetchBillingStatus, isProStatus } from "@/lib/billing/core";

export function useBillingStatusQuery() {
  const userId = useGameUserId();
  return useQuery({ queryKey: billingStatusKey(userId), queryFn: () => fetchBillingStatus(api), enabled: !!userId });
}

/** True only for an unexpired PRO status: a cached `pro` whose `expiresAt` has passed counts as free. */
export function usePro(): boolean {
  return isProStatus(useBillingStatusQuery().data);
}
