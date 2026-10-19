// Custom domains from the server. Create, edit and archive are plain requests sent after the outbox; a custom log is
// queued in the outbox (with its clientId) and sent on the next flush. Each action refetches the custom queries.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useGameUserId } from "@/hooks/useGameState";
import { api } from "@/lib/api/client";
import { getOutbox } from "@/lib/api/outbox";
import {
  archiveCustomDomain,
  createCustomDomain,
  customDomainKey,
  customDomainsKey,
  customRootKeys,
  enqueueCustomLog,
  fetchCustomDomain,
  fetchCustomDomains,
  updateCustomDomain,
  type CustomDomainInput,
} from "@/lib/custom/custom";
import { newClientId, type MutationResult } from "@/lib/game/actions";

export function useCustomDomainsQuery() {
  const userId = useGameUserId();
  return useQuery({ queryKey: customDomainsKey(userId), queryFn: () => fetchCustomDomains(api), enabled: !!userId });
}

export function useCustomDomainQuery(id: string | undefined) {
  const userId = useGameUserId();
  return useQuery({ queryKey: customDomainKey(userId, id ?? ""), queryFn: () => fetchCustomDomain(api, id!), enabled: !!userId && !!id });
}

export function useCustomActions() {
  const queryClient = useQueryClient();
  const userId = useGameUserId();
  const outbox = getOutbox();
  const refresh = useCallback(async () => {
    await Promise.all(customRootKeys(userId).map((queryKey) => queryClient.invalidateQueries({ queryKey })));
  }, [queryClient, userId]);
  const run = useCallback(
    async <T>(prefix: string, send: (clientId: string) => Promise<MutationResult<T>>): Promise<MutationResult<T>> => {
      try {
        return await send(newClientId(prefix));
      } finally {
        await refresh();
      }
    },
    [refresh],
  );
  return {
    create: (input: CustomDomainInput) => run("custom-new", (id) => createCustomDomain(api, outbox, input, id)),
    update: (domainId: string, patch: Partial<CustomDomainInput>) => run("custom-edit", (id) => updateCustomDomain(api, outbox, domainId, patch, id)),
    archive: (domainId: string) => run("custom-archive", (id) => archiveCustomDomain(api, outbox, domainId, id)),
    /** Queues the entry on this device and starts a flush; the pending entry shows until the server has it. */
    log: async (domainId: string, input: { value: number; note?: string }) => {
      await enqueueCustomLog(outbox, domainId, input, newClientId("custom-log"));
      await outbox.flush().catch(() => undefined);
      await refresh();
    },
  };
}
