import type { QueryClient } from "@tanstack/react-query";
import type { KeyValueStorage, Outbox } from "./outbox";

export const LAST_USER_KEY = "system_self.last_user_id";

interface ClientPersister {
  removeClient(): PromiseLike<void> | void;
}

/**
 * Local data (query cache + outbox) belongs to one user. This wipes it on explicit sign-out and when a
 * different user signs in on the same device. Mere session expiry for the same user keeps everything.
 */
export function createLocalDataManager(deps: {
  storage: KeyValueStorage;
  outbox: Outbox;
  queryClient: QueryClient;
  persister: ClientPersister;
}) {
  async function clearLocalData(): Promise<void> {
    deps.queryClient.clear();
    await deps.persister.removeClient();
    await deps.outbox.reset();
    await deps.storage.removeItem(LAST_USER_KEY);
  }

  /** Call after every successful sign-in / register with the resulting user id. */
  async function handleSignIn(userId: string): Promise<void> {
    const last = await deps.storage.getItem(LAST_USER_KEY);
    // A missing marker counts as a different user: unknown ownership of leftover data is never trusted.
    if (last !== userId) await clearLocalData();
    await deps.storage.setItem(LAST_USER_KEY, userId);
  }

  return { clearLocalData, handleSignIn };
}
