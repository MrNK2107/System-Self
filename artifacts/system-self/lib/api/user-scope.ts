import type { QueryClient } from "@tanstack/react-query";
import { activeKey, loadActive } from "../game/gym";
import type { KeyValueStorage, Outbox } from "./outbox";

export const LAST_USER_KEY = "system_self.last_user_id";

interface ClientPersister {
  removeClient(): PromiseLike<void> | void;
}

/**
 * Local data (query cache, outbox, gym session) belongs to one user. This wipes it on explicit sign-out and when a
 * different user signs in on the same device. Mere session expiry for the same user keeps everything.
 */
export function createLocalDataManager(deps: {
  storage: KeyValueStorage;
  outbox: Outbox;
  queryClient: QueryClient;
  persister: ClientPersister;
}) {
  /**
   * `userId` is the account being signed out (its persisted gym session goes too); without it the last
   * signed-in user on this device is assumed.
   */
  async function clearLocalData(userId?: string): Promise<void> {
    const owner = userId ?? (await deps.storage.getItem(LAST_USER_KEY));
    if (owner) await deps.storage.removeItem(activeKey(owner));
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

/**
 * Entries recorded on this device that the server does not have yet: the signed-in user's queued outbox
 * items plus the unsent gym sets saved for `userId`. Signing out erases them.
 */
export async function pendingLocalCount(deps: {
  outbox: Pick<Outbox, "ready" | "pending">;
  storage: KeyValueStorage;
  userId: string | null;
}): Promise<number> {
  await deps.outbox.ready();
  const gymSets = deps.userId ? (await loadActive(deps.storage, deps.userId)).queue.length : 0;
  return deps.outbox.pending().length + gymSets;
}
